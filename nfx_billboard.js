(function () {
    'use strict';

    /* ================================================================
     *  NFX Billboard — v1.9
     *  Netflix-подібний інтерфейс для Lampa (стандартний інтерфейс)
     *
     *    A. Шапка: пошук + вкладки + налаштування, по центру екрана
     *    B. Ряд-білборд: перша картка розгортається у 16:9 з білою
     *       обводкою, фокус прибитий до лівого краю, під рядом — опис
     *    C. Відкрита картка: повноекранний кадр, логотип, білі кнопки
     *
     *  Усі налаштування застосовуються без перезапуску.
     *  Побудовано на публічному API Lampa (Listener, Controller,
     *  SettingsApi, Storage, TMDB) — звірено з yumata/lampa-source.
     * ================================================================ */

    var PLUGIN_ID = 'nfx_billboard';
    var VERSION = '1.9';
    var CSS_ID = 'nfx-billboard-css';
    /**
     * Тривалість і крива переходу.
     * Заміряно по відео Netflix (60 fps, трекінг зсуву смуги постерів):
     * весь рух триває 380 мс, за першу чверть часу проходить 39% шляху —
     * це швидкий старт із гальмуванням, а не симетрична крива.
     */
    var EASE = 'cubic-bezier(0, 0, 0.58, 1)';   // ease-out — підібрано по кадрах відео

    function anim() {
        var v = parseInt(S('nfx_speed', '380'), 10);
        return isNaN(v) ? 380 : v;
    }

    // =================================================================
    //  0. Утиліти
    // =================================================================

    function S(name, def) {
        try { return Lampa.Storage.get(name, def); } catch (e) { return def; }
    }

    function isOn(name, def) {
        var v = S(name, def);
        return v === true || v === 'true' || v === 1 || v === '1';
    }

    function lang() {
        var l = S('language', 'uk');
        return l === 'ua' ? 'uk' : l;
    }

    function tmdbImage(path, size) {
        if (!path) return '';
        try { return Lampa.TMDB.image('t/p/' + size + path); } catch (e) { return ''; }
    }

    function el(tag, cls) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        return node;
    }

    function remove(node) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
    }

    /** Activity.render() віддає то jQuery-обгортку, то DOM — зводимо до DOM */
    function toNode(x) {
        if (!x) return null;
        return x.nodeType ? x : (x[0] || null);
    }

    /** Натиснути чужий елемент так, як це робить навігація Lampa */
    function press(node) {
        if (!node) return;
        try { $(node).trigger('hover:enter'); return; } catch (e) { /* ignore */ }
        try { node.dispatchEvent(new CustomEvent('hover:enter', { bubbles: true })); } catch (e) { /* ignore */ }
    }

    function onEnter(node, handler) {
        try { $(node).on('hover:enter', handler); } catch (e) { /* ignore */ }
        node.addEventListener('hover:enter', handler);
        node.addEventListener('click', handler);
    }

    // =================================================================
    //  1. Жанри TMDB — один запит на мову/тип, далі з кешу
    // =================================================================

    var Genres = {
        map: {},
        pending: {},

        load: function (type) {
            var l = lang();
            var key = 'nfxc_genres_' + type + '_' + l;
            var cached = S(key, null);

            if (cached && typeof cached === 'object') {
                this.map[type] = cached;
                return;
            }

            if (this.pending[key]) return;
            this.pending[key] = true;

            var self = this;
            var url;

            try {
                url = Lampa.TMDB.api('genre/' + type + '/list?api_key=' + Lampa.TMDB.key() + '&language=' + l);
            } catch (e) { this.pending[key] = false; return; }

            $.get(url, function (data) {
                var m = {};
                if (data && data.genres) {
                    for (var i = 0; i < data.genres.length; i++) m[data.genres[i].id] = data.genres[i].name;
                }
                self.map[type] = m;
                self.pending[key] = false;
                try { Lampa.Storage.set(key, m); } catch (e) { /* ignore */ }
            }).fail(function () { self.pending[key] = false; });
        },

        loadAll: function () {
            this.load('movie');
            this.load('tv');
        },

        names: function (type, ids, limit) {
            var m = this.map[type];
            var out = [];
            if (!m || !ids) return out;
            for (var i = 0; i < ids.length && out.length < (limit || 2); i++) {
                if (m[ids[i]]) out.push(m[ids[i]]);
            }
            return out;
        }
    };


    // =================================================================
    //  2. Логотип тайтлу для картки 16:9
    //
    //  На звичайних постерах назва вже намальована в самій картинці.
    //  У кадрі (backdrop) її немає, тому для розгорнутої картки беремо
    //  логотип з TMDB і показуємо рівно того ж розміру, що й на постері.
    //  Кеш під префіксом nfxc_ — щоб запис не сприймався як зміна
    //  налаштування і не перебудовував ряд.
    // =================================================================

    var LogoEngine = {
        key: function (type, id, l) {
            return 'nfxc_logo_' + type + '_' + id + '_' + l;
        },

        getCached: function (k) {
            try {
                var v = sessionStorage.getItem(k);
                if (v) return v;
            } catch (e) { /* ignore */ }
            return S(k, null);
        },

        setCached: function (k, v) {
            var val = v || 'none';
            try { sessionStorage.setItem(k, val); } catch (e) { /* ignore */ }
            try { Lampa.Storage.set(k, val); } catch (e) { /* ignore */ }
        },

        pick: function (logos, target) {
            if (!logos || !logos.length) return null;

            // PNG стабільніші за SVG на старому WebKit
            var sorted = logos.slice().sort(function (a, b) {
                var aSvg = (a.file_path || '').toLowerCase().indexOf('.svg') > -1;
                var bSvg = (b.file_path || '').toLowerCase().indexOf('.svg') > -1;
                return aSvg === bSvg ? 0 : (aSvg ? 1 : -1);
            });

            var order = [target];
            if (order.indexOf('en') === -1) order.push('en');

            var i, j;
            for (j = 0; j < order.length; j++) {
                for (i = 0; i < sorted.length; i++) {
                    if (sorted[i].iso_639_1 === order[j] && sorted[i].file_path) return sorted[i].file_path;
                }
            }

            return sorted[0] && sorted[0].file_path ? sorted[0].file_path : null;
        },

        resolve: function (data, done) {
            if (!data || !data.id) return done(null);

            var type = data.name ? 'tv' : 'movie';
            var l = S('nfx_logo_lang', 'uk') === 'en' ? 'en' : 'uk';
            var k = this.key(type, data.id, l);
            var cached = this.getCached(k);

            if (cached === 'none') return done(null);
            if (cached) return done(cached);

            var self = this;
            var url;

            try {
                url = Lampa.TMDB.api(
                    type + '/' + data.id + '/images?api_key=' + Lampa.TMDB.key() +
                    '&include_image_language=' + (l === 'en' ? 'en,null' : l + ',en,null')
                );
            } catch (e) { return done(null); }

            $.get(url, function (res) {
                var path = self.pick(res && res.logos, l);
                if (path) {
                    var img = tmdbImage(path.replace('.svg', '.png'), 'w300');
                    self.setCached(k, img);
                    done(img);
                } else {
                    self.setCached(k, 'none');
                    done(null);
                }
            }).fail(function () { done(null); });
        },

        mount: function (box, data) {
            this.resolve(data, function (url) {
                if (!url || !box.parentNode) return;
                var img = el('img', 'nfx-hero__logo-img');
                img.src = url;
                box.appendChild(img);
            });
        }
    };

    // =================================================================
    //  3. Ряд-білборд
    // =================================================================

    var Billboard = {
        line: null,
        ctx: null,

        /** Жанри · рік (назва тайтлу тут не потрібна — вона на самій картці) */
        meta: function (data) {
            var isTv = !!data.name;
            var parts = Genres.names(isTv ? 'tv' : 'movie', data.genre_ids, 3);

            var date = data.release_date || data.first_air_date || '';
            if (date) parts.push(date.slice(0, 4));

            if (data.number_of_seasons) parts.push(data.number_of_seasons + ' сез.');

            return parts.join('  ·  ');
        },

        /** Вміст розгорнутої картки 16:9 */
        buildHero: function (cardEl, data) {
            var view = cardEl.querySelector('.card__view');
            if (!view) return;

            remove(view.querySelector('.nfx-hero'));

            var hero = el('div', 'nfx-hero');

            var img = el('img', 'nfx-hero__img');
            img.src = tmdbImage(data.backdrop_path, 'w780') || tmdbImage(data.poster_path, 'w500');
            hero.appendChild(img);

            // затемнення знизу, щоб логотип читався на світлому кадрі
            hero.appendChild(el('div', 'nfx-hero__shade'));

            var logoBox = el('div', 'nfx-hero__logo');
            hero.appendChild(logoBox);
            LogoEngine.mount(logoBox, data);

            // hero кладемо ПІД рідний вміст картки, щоб бейджі інших
            // плагінів лишались видимими
            if (view.firstChild) view.insertBefore(hero, view.firstChild);
            else view.appendChild(hero);

            return hero;
        },

        /**
         * Нерухома рамка 16:9.
         * Обводка не може належати картці: картка їде вліво і стискається,
         * а рамка у Netflix стоїть на місці. Тому це окремий шар над рядом,
         * у ньому ж згасає кадр попереднього тайтлу.
         */
        ensureFrame: function (ctx) {
            if (ctx.frame) return ctx.frame;

            var body = ctx.lineEl.querySelector('.items-line__body');
            if (!body) return null;

            var frame = el('div', 'nfx-frame');
            frame.appendChild(el('div', 'nfx-frame__stroke'));
            body.appendChild(frame);

            // тінь окремим елементом поза рамкою — інакше overflow її зріже
            var glow = el('div', 'nfx-frame__glow');
            body.insertBefore(glow, frame);
            ctx.glow = glow;

            ctx.frame = frame;
            return frame;
        },

        /** Підігнати рамку під геометрію розгорнутої картки */
        placeFrame: function (ctx) {
            if (!ctx.frame || !ctx.current) return;

            var view = ctx.current.querySelector('.card__view');
            var body = ctx.lineEl.querySelector('.items-line__body');
            if (!view || !body) return;

            var a = view.getBoundingClientRect();
            var b = body.getBoundingClientRect();

            if (!a.width || !a.height) return;

            // Рамка ставиться тільки за геометрією картки в спокої.
            // Якщо анімація ще не доїхала, ширина буде проміжною —
            // у такому разі не чіпаємо рамку взагалі.
            var expect = ctx.stepPx ? (ctx.wideExpect || 0) : 0;
            if (expect && Math.abs(a.width - expect) > 2) return;
            if (!expect) ctx.wideExpect = a.width;

            var box = {
                left: (a.left - b.left) + 'px',
                top: (a.top - b.top) + 'px',
                width: a.width + 'px',
                height: a.height + 'px'
            };

            ctx.frame.style.left = box.left;
            ctx.frame.style.top = box.top;
            ctx.frame.style.width = box.width;
            ctx.frame.style.height = box.height;
            ctx.frame.classList.add('nfx-frame--on');

            if (ctx.glow) {
                ctx.glow.style.left = box.left;
                ctx.glow.style.top = box.top;
                ctx.glow.style.width = box.width;
                ctx.glow.style.height = box.height;
            }
        },

        /** Блок під рядом: два шари для крос-фейду */
        buildInfo: function (lineEl) {
            var box = el('div', 'nfx-info');
            var layers = [];
            var i;

            for (i = 0; i < 2; i++) {
                var layer = el('div', 'nfx-info__layer' + (i === 0 ? ' nfx-info__layer--active' : ''));
                layer.appendChild(el('div', 'nfx-info__meta'));
                layer.appendChild(el('div', 'nfx-info__text'));
                box.appendChild(layer);
                layers.push(layer);
            }

            var body = lineEl.querySelector('.items-line__body');
            if (body && body.parentNode) body.parentNode.insertBefore(box, body.nextSibling);
            else lineEl.appendChild(box);

            return { box: box, layers: layers, index: 0, first: true };
        },

        renderInfo: function (info, data) {
            if (!info) return;

            var target;

            if (info.first) {
                info.first = false;
                target = info.layers[info.index];
            } else {
                target = info.layers[(info.index + 1) % 2];
                info.layers[info.index].classList.remove('nfx-info__layer--active');
                target.classList.add('nfx-info__layer--active');
                info.index = (info.index + 1) % 2;
            }

            target.querySelector('.nfx-info__meta').textContent = this.meta(data);
            target.querySelector('.nfx-info__text').textContent = data.overview || '';
        },

        attach: function (line) {
            if (!line || this.ctx) return;

            var self = this;
            var lineEl = line.render(true);

            lineEl.classList.add('items-line--nfx');

            var ctx = {
                line: line,
                lineEl: lineEl,
                info: isOn('nfx_info', true) ? this.buildInfo(lineEl) : null,
                current: null,
                timer: null,
                module: null,
                frame: null,
                glow: null,
                ready: false,
                pw: 0,
                settle: null
            };

            /** .scroll__body цього ряду — саме йому Lampa ставить transform */
            ctx.body = function () {
                return lineEl.querySelector('.items-line__body .scroll__body');
            };

            /**
             * Куди має від'їхати ряд, щоб обрана картка стала точно в рамку.
             *
             * Рахуємо аналітично, а не з живої геометрії: під час анімації
             * getBoundingClientRect віддає проміжні значення, і позиція
             * поїхала б. Формула: ліве прибиття це transform = -offsetLeft,
             * а offsetLeft зміниться на (E - W), якщо картка, що згортається,
             * стоїть лівіше за нову.
             */
            /**
             * Крок ряду: ширина постера + проміжок. Міряємо один раз у
             * спокої, коли жодна картка ще не розгорнута.
             */
            ctx.step = function () {
                if (ctx.stepPx) return ctx.stepPx;

                var cards = ctx.lineEl.querySelectorAll('.items-line__body .card');

                // потрібна пара сусідніх ЗГОРНУТИХ карток: розгорнута має
                // іншу ширину, а під час анімації ще й проміжну
                for (var i = 0; i + 1 < cards.length; i++) {
                    var a = cards[i], b = cards[i + 1];
                    if (a.classList.contains('nfx-open') || b.classList.contains('nfx-open')) continue;

                    var d = b.offsetLeft - a.offsetLeft;
                    if (d > 0) {
                        ctx.stepPx = d;
                        return d;
                    }
                }

                return 0;
            };

            /**
             * Куди має від'їхати ряд, щоб картка з індексом i стала в рамку.
             *
             * Рахуємо від індексу, а не з offsetLeft/offsetWidth: під час
             * анімації ці значення проміжні, і при швидкому натисканні ряд
             * зупинявся не там — рамка опинялась не над обраною карткою.
             * Усі картки лівіше обраної завжди постери, тому зсув це просто
             * індекс на крок.
             */
            ctx.target = function (index) {
                var step = ctx.step();
                if (!step || index < 0) return null;
                return -(index * step);
            };

            ctx.open = function (item) {
                if (!item) return;

                var nextEl = item.render(true);
                if (!nextEl || ctx.current === nextEl) return;

                var prevEl = ctx.current;
                var data = item.data || nextEl.card_data || {};
                var animate = !!prevEl && ctx.ready;

                // крок ряду міряємо до першого розгортання, поки всі
                // картки однакові
                if (!ctx.stepPx) ctx.step();

                var index = -1;
                if (line.items) {
                    for (var k = 0; k < line.items.length; k++) {
                        if (line.items[k] === item) { index = k; break; }
                    }
                }

                // 1. кадр попереднього тайтлу перекладаємо в нерухому рамку
                //    і гасимо — саме так виглядає перехід у Netflix
                if (prevEl) {
                    var oldHero = prevEl.querySelector('.nfx-hero');
                    var frameReady = ctx.frame && ctx.frame.classList.contains('nfx-frame--on');
                    if (oldHero && frameReady && animate) {
                        // при швидкому перемиканні старі шари могли накопичуватись
                        var stale = ctx.frame.querySelectorAll('.nfx-hero--out');
                        for (var q = 0; q < stale.length; q++) remove(stale[q]);

                        oldHero.classList.add('nfx-hero--out');
                        ctx.frame.insertBefore(oldHero, ctx.frame.firstChild);
                        setTimeout(function () { remove(oldHero); }, anim() + 60);
                        requestAnimationFrame(function () { oldHero.style.opacity = '0'; });
                    } else {
                        remove(oldHero);
                    }
                    prevEl.classList.remove('nfx-open');
                }

                // 2. позиція — від індексу, тому не залежить від того,
                //    чи доїхала попередня анімація
                var to = animate ? ctx.target(index) : null;

                ctx.current = nextEl;
                nextEl.classList.add('nfx-open');

                self.buildHero(nextEl, data);
                self.renderInfo(ctx.info, data);

                // 3. ширина карток і зсув ряду їдуть одночасно, однією
                //    тривалістю — інакше картка спершу росте, потім ряд їде
                var body = ctx.body();

                if (animate && body && to !== null && S('nfx_pin', 'left') === 'left') {
                    body.style.transition = 'transform ' + anim() + 'ms ' + EASE;
                    body.style.webkitTransition = '-webkit-transform ' + anim() + 'ms ' + EASE;
                    body.style.transform = 'translate3d(' + to + 'px, 0px, 0px)';
                    body.style.webkitTransform = 'translate3d(' + to + 'px, 0px, 0px)';
                } else if (S('nfx_pin', 'left') === 'left' && line.scroll) {
                    line.scroll.update(nextEl, false);
                }

                // 4. Рамку міряємо тільки після того, як усе стало на місце:
                //    під час анімації getBoundingClientRect віддає проміжні
                //    значення, і рамка ставала не туди. Робимо це після
                //    кожного переходу — так вона сама себе виправляє.
                clearTimeout(ctx.settle);
                ctx.settle = setTimeout(function () {
                    if (!ctx.stepPx) ctx.step();
                    self.ensureFrame(ctx);
                    self.placeFrame(ctx);

                    if (!ctx.ready) {
                        ctx.lineEl.classList.add('items-line--nfx-anim');
                        ctx.ready = true;
                    }
                }, anim() + 80);
            };

            ctx.module = {
                onActive: function (item) { ctx.open(item); },
                onDestroy: function () { self.detach(); }
            };

            line.use(ctx.module);

            var tries = 0;
            ctx.timer = setInterval(function () {
                if (ctx.current || tries++ > 40) return clearInterval(ctx.timer);
                if (line.items && line.items.length) {
                    ctx.open(line.items[0]);
                    clearInterval(ctx.timer);
                }
            }, 100);

            this.ctx = ctx;
        },

        detach: function () {
            var ctx = this.ctx;
            if (!ctx) return;

            clearInterval(ctx.timer);
            clearTimeout(ctx.settle);

            if (ctx.current) {
                ctx.current.classList.remove('nfx-open');
                remove(ctx.current.querySelector('.nfx-hero'));
            }

            if (ctx.info) remove(ctx.info.box);
            remove(ctx.frame);
            remove(ctx.glow);

            if (ctx.lineEl) {
                ctx.lineEl.classList.remove('items-line--nfx');
                ctx.lineEl.classList.remove('items-line--nfx-anim');
            }

            if (ctx.line && ctx.module && ctx.line.components) {
                ctx.line.components = ctx.line.components.filter(function (c) {
                    return c !== ctx.module;
                });
            }

            this.ctx = null;
        },

        sync: function () {
            this.detach();
            if (isOn('nfx_row', true) && this.line) this.attach(this.line);
        },

        /** Рамка привʼязана до пікселів — після зміни розміру екрана переміряти */
        remeasure: function () {
            if (!this.ctx) return;
            this.ctx.stepPx = 0;
            this.placeFrame(this.ctx);
        },

        isTarget: function (line) {
            var lineEl = line.render(true);
            if (!lineEl || !lineEl.parentNode) return false;

            var siblings = lineEl.parentNode.querySelectorAll('.items-line');
            if (!siblings.length || siblings[0] !== lineEl) return false;

            if (S('nfx_scope', 'main') === 'main') {
                var act = Lampa.Activity.active();
                if (!act || act.component !== 'main') return false;
            }

            return true;
        },

        init: function () {
            var self = this;

            var resizeTimer = null;
            window.addEventListener('resize', function () {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(function () { self.remeasure(); }, 200);
            });

            Lampa.Listener.follow('line', function (e) {
                if (e.type !== 'create') return;

                setTimeout(function () {
                    try {
                        if (!self.isTarget(e.line)) return;
                        self.line = e.line;
                        self.sync();
                    } catch (err) {
                        console.log('[NFX] line', err);
                    }
                }, 0);
            });
        }
    };

    // =================================================================
    //  4. Відкрита картка (сторінка тайтлу)
    // =================================================================

    var FullCard = {
        enabled: function () {
            return S('nfx_full', 'netflix') === 'netflix';
        },

        process: function (e) {
            if (!this.enabled()) return;

            var root = toNode(e.object && e.object.activity && e.object.activity.render());
            var data = e.data && e.data.movie;
            if (!root || !data) return;

            root.classList.add('nfx-full');

            // повноекранний кадр — якщо Lampa не підставила свій, ставимо свій шар
            var bg = root.querySelector('.full-start-new__background, .full-start__background');
            var url = tmdbImage(data.backdrop_path, 'w1280') || tmdbImage(data.poster_path, 'w780');

            if (!bg && url) {
                var host = root.querySelector('.full-start-new, .full-start');
                if (host) {
                    var layer = el('div', 'nfx-full__bg');
                    layer.style.backgroundImage = 'url(' + url + ')';
                    if (host.firstChild) host.insertBefore(layer, host.firstChild);
                    else host.appendChild(layer);
                }
            }

        },

        init: function () {
            var self = this;
            Lampa.Listener.follow('full', function (e) {
                if (e.type !== 'complite') return;
                try { self.process(e); } catch (err) { console.log('[NFX] full', err); }
            });
        }
    };

    // =================================================================
    //  5. Шапка
    // =================================================================

    var NAV_PRESETS = {
        basic: ['main', 'tv', 'movie'],
        plus: ['main', 'tv', 'movie', 'catalog'],
        full: ['main', 'tv', 'movie', 'anime', 'catalog', 'favorite']
    };

    var ICON_SETTINGS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="3"></circle>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

    var Nav = {
        node: null,
        last: null,
        timer: null,

        trackFocus: function (node) {
            var self = this;
            var set = function (e) { self.last = (e && e.target) ? e.target : node; };
            try { $(node).on('hover:focus hover:hover hover:touch', set); } catch (e) { /* ignore */ }
            node.addEventListener('hover:focus', set);
        },

        markActive: function (action) {
            if (!this.node) return;
            var tabs = this.node.querySelectorAll('.nfx-nav__tab');
            for (var i = 0; i < tabs.length; i++) {
                if (tabs[i].getAttribute('data-action') === action) tabs[i].classList.add('nfx-nav__tab--active');
                else tabs[i].classList.remove('nfx-nav__tab--active');
            }
        },

        build: function () {
            var headBody = document.querySelector('.head .head__body');
            if (!headBody) return false;
            if (!document.querySelector('.menu__item[data-action="main"]')) return false;

            var self = this;
            var nav = el('div', 'nfx-nav');
            var group = el('div', 'nfx-nav__group');

            nav.appendChild(group);
            headBody.appendChild(nav);
            this.node = nav;

            var search = document.querySelector('.head__action.open--search');
            if (search) {
                search.classList.add('nfx-nav__search');
                group.appendChild(search);
                this.trackFocus(search);
            }

            var actions = NAV_PRESETS[S('nfx_nav_items', 'basic')] || NAV_PRESETS.basic;

            actions.forEach(function (action) {
                var src = document.querySelector('.menu__item[data-action="' + action + '"]');
                if (!src) return;

                var label = src.querySelector('.menu__text');
                var tab = el('div', 'nfx-nav__tab selector');
                tab.setAttribute('data-action', action);
                tab.textContent = label ? label.textContent.trim() : action;

                onEnter(tab, function () {
                    self.markActive(action);
                    press(src);
                });
                self.trackFocus(tab);

                group.appendChild(tab);
            });

            var settingsSrc = document.querySelector('.menu__item[data-action="settings"]');
            var btn = el('div', 'nfx-nav__settings selector');
            btn.innerHTML = ICON_SETTINGS;
            onEnter(btn, function () {
                if (settingsSrc) press(settingsSrc);
                else if (window.Lampa && Lampa.Settings) Lampa.Settings.show({ category: 'main' });
            });
            this.trackFocus(btn);
            group.appendChild(btn);

            this.markActive('main');
            document.body.classList.add('nfx-nav-on');

            return true;
        },

        destroy: function () {
            if (!this.node) return;

            var search = this.node.querySelector('.open--search');
            var actions = document.querySelector('.head .head__actions');
            if (search && actions) {
                search.classList.remove('nfx-nav__search');
                actions.appendChild(search);
            }

            remove(this.node);
            this.node = null;
            this.last = null;
            document.body.classList.remove('nfx-nav-on');
        },

        /** Свій контролер шапки — реєструється один раз, працює в обох станах */
        controller: function () {
            var self = this;
            var headEl = document.querySelector('.head');
            if (!headEl) return;

            try {
                Lampa.Controller.add('head', {
                    toggle: function () {
                        Lampa.Controller.collectionSet(headEl, false, true);
                        Lampa.Controller.collectionFocus(self.last || false, headEl, true);
                    },
                    right: function () { Navigator.move('right'); },
                    left: function () {
                        if (Navigator.canmove('left')) Navigator.move('left');
                        else if (!self.node) Lampa.Controller.toggle('menu');
                    },
                    down: function () { Lampa.Controller.toggle('content'); },
                    back: function () { Lampa.Activity.backward(); }
                });
            } catch (e) {
                console.log('[NFX] head controller', e);
            }
        },

        sync: function () {
            if (!isOn('nfx_nav', true)) return this.destroy();
            if (this.node) this.destroy();

            var self = this;
            var tries = 0;

            clearInterval(this.timer);
            this.timer = setInterval(function () {
                if (!isOn('nfx_nav', true) || self.build() || tries++ > 60) clearInterval(self.timer);
            }, 200);
        },

        init: function () {
            var self = this;

            this.controller();
            this.sync();

            Lampa.Listener.follow('activity', function (e) {
                if (e.type === 'start' && e.component === 'main') self.markActive('main');
            });
        }
    };

    // =================================================================
    //  6. CSS
    // =================================================================

    function injectCSS() {
        remove(document.getElementById(CSS_ID));

        var focus = S('nfx_focus', 'shadow');
        var wideEm = parseFloat(S('nfx_wide', '34em')) || 34;
        var height = wideEm * 9 / 16;       // висота рамки 16:9
        var poster = height / 1.5;          // постер 2:3 тієї ж висоти
        var radius = S('nfx_radius', '0.4em');
        var titles = isOn('nfx_titles', false) ? 'block' : 'none';
        var blackBg = S('nfx_bg', 'lampa') === 'black';
        var fullNfx = S('nfx_full', 'netflix') === 'netflix';

        var css = [];

        /* ── фон сторінки ── */
        if (blackBg) {
            css.push('body { background-color: #000 !important; }');
            css.push('body .background { display: none !important; }');
        }

        /* ── шапка ── */
        css.push('.nfx-nav { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; min-width: 0; }');
        css.push('.nfx-nav__group { display: flex; align-items: center; justify-content: center; max-width: 100%; overflow: hidden; }');

        css.push('.nfx-nav__search { width: 2.2em; height: 2.2em; margin: 0 0.6em 0 0; padding: 0 !important;' +
            ' display: flex !important; align-items: center; justify-content: center;' +
            ' border-radius: 2em; color: #fff; background: none !important; }');
        css.push('.nfx-nav__search svg { width: 1.35em; height: 1.35em; fill: currentColor; }');
        css.push('.nfx-nav__search.focus, .nfx-nav__search:hover { background: #fff !important; color: #000; }');

        css.push('.nfx-nav__tab { padding: 0.42em 1.15em; margin: 0 0.15em; border-radius: 2em;' +
            ' font-size: 1.05em; font-weight: 700; color: #fff;' +
            ' white-space: nowrap; cursor: pointer; background: transparent; }');
        css.push('.nfx-nav__tab--active { background: rgba(255,255,255,0.22); }');
        css.push('.nfx-nav__tab.focus, .nfx-nav__tab:hover { background: #fff !important; color: #000 !important; }');

        css.push('.nfx-nav__settings { width: 2.2em; height: 2.2em; margin-left: 0.6em;' +
            ' display: flex; align-items: center; justify-content: center;' +
            ' border-radius: 2em; color: #fff; cursor: pointer; background: transparent; }');
        css.push('.nfx-nav__settings svg { width: 1.35em; height: 1.35em; }');
        css.push('.nfx-nav__settings.focus, .nfx-nav__settings:hover { background: #fff; color: #000; }');

        css.push('body.nfx-nav-on .head__logo-icon,' +
            ' body.nfx-nav-on .head__menu-icon,' +
            ' body.nfx-nav-on .head__title,' +
            ' body.nfx-nav-on .head__time,' +
            ' body.nfx-nav-on .head__markers,' +
            ' body.nfx-nav-on .head__backward,' +
            ' body.nfx-nav-on .head__actions { display: none !important; }');
        css.push('body.nfx-nav-on .head { box-shadow: none !important; }');
        css.push('body.nfx-nav-on .head__body { justify-content: center; padding-top: 0.7em; padding-bottom: 0.7em; }');
        css.push('body.nfx-nav-on .wrap__left { width: 15em !important; margin-left: -15em !important; }');
        css.push('body.nfx-nav-on:not(.menu--open) .wrap__left { visibility: hidden !important; }');
        css.push('body.nfx-nav-on.menu--always.menu--open .wrap__content { transform: translate3d(15em,0,0) !important; }');

        /* ── ряд ── */
        css.push('.items-line--nfx { padding-bottom: 1.4em !important; }');
        css.push('.items-line--nfx .items-line__body { position: relative; }');
        css.push('.items-line--nfx .card__title, .items-line--nfx .card__age { display: ' + titles + ' !important; }');

        // Висота ряду не змінюється: постер 2:3 і кадр 16:9 мають однакову
        // висоту, тому ширина постера жорстко привʼязана до ширини рамки.
        css.push('.items-line--nfx .card { width: ' + poster + 'em !important; }');
        css.push('.items-line--nfx .card__view { margin-bottom: 0.3em !important; overflow: hidden;' +
            ' border-radius: ' + radius + '; height: ' + height + 'em !important; padding-bottom: 0 !important; }');
        css.push('.items-line--nfx .card__img { border-radius: ' + radius + '; }');

        // анімація вмикається лише після першого відкриття
        css.push('.items-line--nfx-anim .card {' +
            ' -webkit-transition: width ' + anim() + 'ms ' + EASE + ';' +
            ' transition: width ' + anim() + 'ms ' + EASE + '; }');

        // Lampa підстрибує карткою у фокусі (animation-card-focus) — гасимо
        css.push('.items-line--nfx .card.focus .card__view,' +
            ' .items-line--nfx .card.hover .card__view,' +
            ' .items-line--nfx .card.animate-trigger-enter .card__view {' +
            ' animation: none !important; -webkit-animation: none !important; }');

        /* ── розгорнута картка 16:9 ── */
        css.push('.items-line--nfx .card.nfx-open { width: ' + wideEm + 'em !important; }');
        css.push('.items-line--nfx .card.nfx-open .card__img { opacity: 0; }');

        /* нерухома рамка 16:9 */
        css.push('.nfx-frame { position: absolute; z-index: 6; pointer-events: none;' +
            ' opacity: 0; border-radius: ' + radius + '; overflow: hidden; }');
        css.push('.nfx-frame--on { opacity: 1; }');
        css.push('.nfx-frame__stroke { position: absolute; left: 0; top: 0; right: 0; bottom: 0;' +
            ' z-index: 2; border-radius: ' + radius + '; border: 0.14em solid #fff; }');

        if (focus !== 'off') {
            // тінь на самій рамці: overflow:hidden обрізав би її, тому
            // вішаємо на окремий шар, розтягнутий під рамку
            css.push('.nfx-frame__glow { position: absolute; z-index: 5; pointer-events: none;' +
                ' border-radius: ' + radius + ';' +
                ' box-shadow: 0 1.2em 3em rgba(0,0,0,0.75), 0 0 1.6em rgba(0,0,0,0.55); }');
        }

        if (focus === 'dim') {
            css.push('.items-line--nfx .card .card__view { -webkit-filter: brightness(0.62);' +
                ' filter: brightness(0.62);' +
                ' -webkit-transition: -webkit-filter ' + anim() + 'ms ' + EASE + ';' +
                ' transition: filter ' + anim() + 'ms ' + EASE + '; }');
            css.push('.items-line--nfx .card.nfx-open .card__view { -webkit-filter: none; filter: none; }');
        }
        css.push('.nfx-hero--out { position: absolute; left: 0; top: 0; right: 0; bottom: 0;' +
            ' z-index: 1; border-radius: ' + radius + ';' +
            ' -webkit-transition: opacity ' + anim() + 'ms ' + EASE + ';' +
            ' transition: opacity ' + anim() + 'ms ' + EASE + '; }');

        css.push('.nfx-hero { position: absolute; left: 0; top: 0; right: 0; bottom: 0;' +
            ' border-radius: ' + radius + '; overflow: hidden; }');
        css.push('.nfx-hero__img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }');
        css.push('.nfx-hero__shade { position: absolute; left: 0; right: 0; bottom: 0; height: 55%; z-index: 2;' +
            ' background: -webkit-linear-gradient(top, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%);' +
            ' background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%); }');

        // Розмір логотипа привʼязаний до ширини ПОСТЕРА, а не рамки —
        // щоб на картці 16:9 назва виглядала так само, як на сусідніх.
        css.push('.nfx-hero__logo { position: absolute; left: 0.9em; bottom: 0.8em; z-index: 3;' +
            ' max-width: ' + (poster * 0.8).toFixed(2) + 'em;' +
            ' max-height: ' + (poster * 0.30).toFixed(2) + 'em;' +
            ' display: flex; align-items: flex-end; pointer-events: none; }');
        css.push('.nfx-hero__logo-img { max-width: 100%; max-height: 100%; width: auto; height: auto;' +
            ' object-fit: contain; object-position: left bottom;' +
            ' filter: drop-shadow(0 2px 10px rgba(0,0,0,0.8)); }');

        /* ── блок під рядом ── */
        css.push('.nfx-info { position: relative; margin: 0.1em 0 0 0; padding: 0 1.5em; min-height: 6.6em; }');
        css.push('.nfx-info__layer { position: absolute; left: 1.5em; right: 1.5em; top: 0;' +
            ' opacity: 0; pointer-events: none;' +
            ' -webkit-transition: opacity 0.3s ease; transition: opacity 0.3s ease; }');
        css.push('.nfx-info__layer--active { opacity: 1; }');
        css.push('.nfx-info__meta { font-size: 1.05em; font-weight: 600; line-height: 1.3;' +
            ' color: rgba(255,255,255,0.9); margin-bottom: 0.3em; }');
        css.push('.nfx-info__text { font-size: 1.05em; line-height: 1.4; max-width: 46em;' +
            ' color: rgba(255,255,255,0.7);' +
            ' display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }');

        /* ── відкрита картка ── */
        if (fullNfx) {
            css.push('.nfx-full .full-start-new, .nfx-full .full-start {' +
                ' position: relative; overflow: hidden; margin: 0; padding: 0; }');

            // кадр на всю ширину, без масок
            css.push('.nfx-full .full-start-new__background,' +
                ' .nfx-full .full-start__background,' +
                ' .nfx-full .nfx-full__bg {' +
                ' position: absolute !important; left: 0 !important; top: -6em !important;' +
                ' width: 100% !important; height: calc(100% + 6em) !important;' +
                ' margin: 0 !important; padding: 0 !important;' +
                ' background-size: cover; background-position: center top;' +
                ' -webkit-mask-image: none !important; mask-image: none !important; }');
            css.push('.nfx-full .full-start-new__background img,' +
                ' .nfx-full .full-start__background img {' +
                ' width: 100% !important; height: 100% !important; object-fit: cover !important; filter: none !important; }');

            // затемнення знизу під текст
            css.push('.nfx-full .full-start-new::after, .nfx-full .full-start::after {' +
                ' content: ""; display: block; position: absolute; left: 0; right: 0; bottom: 0; top: -6em;' +
                ' pointer-events: none; z-index: 1;' +
                ' background: -webkit-linear-gradient(top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.85) 100%);' +
                ' background: linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.85) 100%); }');

            // постер збоку не потрібен — кадр і так на весь екран
            css.push('.nfx-full .full-start-new__left, .nfx-full .full-start__left { display: none !important; }');
            css.push('.nfx-full .full-start-new__reactions, .nfx-full .full-start__reactions { display: none !important; }');

            css.push('.nfx-full .full-start-new__body, .nfx-full .full-start__body {' +
                ' position: relative; z-index: 2; display: flex; align-items: flex-end;' +
                ' min-height: 78vh; padding-left: 4%; padding-top: 6em; padding-bottom: 2em; }');
            css.push('.nfx-full .full-start-new__right, .nfx-full .full-start__right {' +
                ' position: relative; z-index: 3; max-width: 46em;' +
                ' display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-end; }');

            // заголовок тайтлу — читабельний поверх кадру
            css.push('.nfx-full .full-start-new__title, .nfx-full .full-start__title {' +
                ' text-shadow: 0 3px 16px rgba(0,0,0,0.85); background: none !important; }');

            // кнопки: біла — активна, напівпрозора — решта
            css.push('.nfx-full .full-start__button, .nfx-full .full-start-new__button {' +
                ' border-radius: 2em; border: none;' +
                ' background: rgba(255,255,255,0.28); color: #fff;' +
                ' font-weight: 700; }');
            css.push('.nfx-full .full-start__button svg, .nfx-full .full-start-new__button svg {' +
                ' fill: currentColor; stroke: currentColor; }');
            css.push('.nfx-full .full-start__button.focus, .nfx-full .full-start__button:hover,' +
                ' .nfx-full .full-start-new__button.focus, .nfx-full .full-start-new__button:hover {' +
                ' background: #fff !important; color: #000 !important; }');
            css.push('.nfx-full .full-start__button.focus *, .nfx-full .full-start__button:hover *,' +
                ' .nfx-full .full-start-new__button.focus *, .nfx-full .full-start-new__button:hover * {' +
                ' color: #000 !important; fill: #000 !important; stroke: #000 !important; }');
        }

        /* ── малі екрани ── */
        css.push('@media screen and (max-width: 767px) {' +
            ' .nfx-info { min-height: 5.8em; padding: 0 1em; }' +
            ' .nfx-info__layer { left: 1em; right: 1em; }' +
            ' .nfx-nav__tab { font-size: 0.95em; padding: 0.35em 0.8em; } }');

        var style = document.createElement('style');
        style.id = CSS_ID;
        style.textContent = css.join('\n');
        document.head.appendChild(style);
    }

    // =================================================================
    //  7. Застосування налаштувань
    // =================================================================

    /** Тільки ці ключі є налаштуваннями. Кеш (nfxc_*) сюди не потрапляє. */
    var SETTING_KEYS = [
        'nfx_nav', 'nfx_nav_items', 'nfx_bg', 'nfx_full', 'nfx_radius',
        'nfx_titles', 'nfx_row', 'nfx_scope', 'nfx_pin', 'nfx_wide',
        'nfx_info', 'nfx_speed', 'nfx_focus', 'nfx_logo_lang'
    ];

    function isSettingKey(name) {
        return SETTING_KEYS.indexOf(name) > -1;
    }

    var applyTimer = null;

    /** SettingsApi.onChange і Storage.change приходять парою — склеюємо */
    function applyAll() {
        clearTimeout(applyTimer);
        applyTimer = setTimeout(function () {
            injectCSS();
            Nav.sync();
            Billboard.sync();
        }, 120);
    }

    // =================================================================
    //  8. Налаштування
    // =================================================================

    var I18N = {
        uk: {
            title: 'NFX Billboard',
            nav: 'Шапка в стилі Netflix',
            nav_items: 'Вкладки в шапці',
            nav_basic: 'Головна / Серіали / Фільми',
            nav_plus: '+ Каталог',
            nav_full: '+ Аніме, Каталог, Обране',
            bg: 'Фон за картками',
            bg_lampa: 'Як зараз (фон Lampa)',
            bg_black: 'Чорний',
            full: 'Вигляд відкритої картки',
            full_lampa: 'Як у Lampa',
            full_nfx: 'Netflix (кадр на весь екран, білі кнопки)',
            radius: 'Заокруглення кутів',
            titles: 'Назви під картками',
            row: 'Увімкнути ряд-білборд',
            scope: 'Де застосовувати',
            scope_main: 'Тільки головна',
            scope_all: 'Усі сторінки з рядами',
            pin: 'Позиція фокуса в ряду',
            pin_left: 'Ліворуч (Netflix)',
            pin_center: 'По центру (як у Lampa)',
            wide: 'Ширина розгорнутої картки',
            info: 'Блок опису під рядом',
            logo_lang: 'Мова логотипу на картці 16:9',
            speed: 'Швидкість переходу',
            sp_fast: 'Швидко (260 мс)',
            sp_nfx: 'Як у Netflix (380 мс)',
            sp_slow: 'Повільно (500 мс)',
            focus: 'Виділення обраної картки',
            f_off: 'Тільки обводка',
            f_shadow: 'Обводка і тінь',
            f_dim: 'Обводка, тінь, затемнення інших'
        },
        ru: {
            title: 'NFX Billboard',
            nav: 'Шапка в стиле Netflix',
            nav_items: 'Вкладки в шапке',
            nav_basic: 'Главная / Сериалы / Фильмы',
            nav_plus: '+ Каталог',
            nav_full: '+ Аниме, Каталог, Избранное',
            bg: 'Фон за карточками',
            bg_lampa: 'Как сейчас (фон Lampa)',
            bg_black: 'Чёрный',
            full: 'Вид открытой карточки',
            full_lampa: 'Как в Lampa',
            full_nfx: 'Netflix (кадр на весь экран, белые кнопки)',
            radius: 'Скругление углов',
            titles: 'Названия под карточками',
            row: 'Включить ряд-билборд',
            scope: 'Где применять',
            scope_main: 'Только главная',
            scope_all: 'Все страницы с рядами',
            pin: 'Позиция фокуса в ряду',
            pin_left: 'Слева (Netflix)',
            pin_center: 'По центру (как в Lampa)',
            wide: 'Ширина развёрнутой карточки',
            info: 'Блок описания под рядом',
            logo_lang: 'Язык логотипа на карточке 16:9',
            speed: 'Скорость перехода',
            sp_fast: 'Быстро (260 мс)',
            sp_nfx: 'Как в Netflix (380 мс)',
            sp_slow: 'Медленно (500 мс)',
            focus: 'Выделение выбранной карточки',
            f_off: 'Только обводка',
            f_shadow: 'Обводка и тень',
            f_dim: 'Обводка, тень, затемнение остальных'
        },
        en: {
            title: 'NFX Billboard',
            nav: 'Netflix-style header',
            nav_items: 'Header tabs',
            nav_basic: 'Home / Series / Movies',
            nav_plus: '+ Catalog',
            nav_full: '+ Anime, Catalog, Favorites',
            bg: 'Background behind cards',
            bg_lampa: 'As is (Lampa background)',
            bg_black: 'Black',
            full: 'Opened card look',
            full_lampa: 'Lampa default',
            full_nfx: 'Netflix (full-bleed backdrop, white buttons)',
            radius: 'Corner radius',
            titles: 'Titles under cards',
            row: 'Enable billboard row',
            scope: 'Where to apply',
            scope_main: 'Main page only',
            scope_all: 'All pages with rows',
            pin: 'Focus position in row',
            pin_left: 'Left (Netflix)',
            pin_center: 'Center (Lampa default)',
            wide: 'Expanded card width',
            info: 'Description block under row',
            logo_lang: 'Logo language on the 16:9 card',
            speed: 'Transition speed',
            sp_fast: 'Fast (260 ms)',
            sp_nfx: 'Netflix (380 ms)',
            sp_slow: 'Slow (500 ms)',
            focus: 'Selected card highlight',
            f_off: 'Border only',
            f_shadow: 'Border and shadow',
            f_dim: 'Border, shadow, dim the rest'
        }
    };

    function initSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        var dict = I18N[lang()] || I18N.en;
        function t(k) { return dict[k] || I18N.en[k] || k; }

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            name: t('title'),
            icon: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="12" height="14" rx="2"></rect><rect x="16" y="8" width="6" height="8" rx="1"></rect></svg>'
        });

        var params = [
            { name: 'nfx_nav', type: 'trigger', def: true, title: t('nav') },
            { name: 'nfx_nav_items', type: 'select', def: 'basic', title: t('nav_items'),
              values: { basic: t('nav_basic'), plus: t('nav_plus'), full: t('nav_full') } },

            { name: 'nfx_full', type: 'select', def: 'netflix', title: t('full'),
              values: { lampa: t('full_lampa'), netflix: t('full_nfx') } },
            { name: 'nfx_bg', type: 'select', def: 'lampa', title: t('bg'),
              values: { lampa: t('bg_lampa'), black: t('bg_black') } },
            { name: 'nfx_radius', type: 'select', def: '0.4em', title: t('radius'),
              values: { '0em': '0', '0.4em': '0.4em', '0.8em': '0.8em', '1em': '1em' } },
            { name: 'nfx_titles', type: 'trigger', def: false, title: t('titles') },

            { name: 'nfx_row', type: 'trigger', def: true, title: t('row') },
            { name: 'nfx_scope', type: 'select', def: 'main', title: t('scope'),
              values: { main: t('scope_main'), all: t('scope_all') } },
            { name: 'nfx_pin', type: 'select', def: 'left', title: t('pin'),
              values: { left: t('pin_left'), center: t('pin_center') } },
            { name: 'nfx_wide', type: 'select', def: '34em', title: t('wide'),
              values: { '28em': '2.2x', '31em': '2.4x', '34em': '2.7x (16:9)', '38em': '3.0x' } },
            { name: 'nfx_info', type: 'trigger', def: true, title: t('info') },
            { name: 'nfx_logo_lang', type: 'select', def: 'uk', title: t('logo_lang'),
              values: { uk: 'Українська', en: 'English' } },
            { name: 'nfx_speed', type: 'select', def: '380', title: t('speed'),
              values: { '260': t('sp_fast'), '380': t('sp_nfx'), '500': t('sp_slow') } },
            { name: 'nfx_focus', type: 'select', def: 'shadow', title: t('focus'),
              values: { off: t('f_off'), shadow: t('f_shadow'), dim: t('f_dim') } }
        ];

        params.forEach(function (p) {
            var conf = { name: p.name, type: p.type, default: p.def };
            if (p.values) conf.values = p.values;

            Lampa.SettingsApi.addParam({
                component: PLUGIN_ID,
                param: conf,
                field: { name: p.title },
                onChange: applyAll
            });
        });
    }

    // =================================================================
    //  9. Старт
    // =================================================================

    function bootstrap() {
        if (window.__nfx_billboard) return;
        window.__nfx_billboard = true;

        initSettings();
        injectCSS();
        Genres.loadAll();
        Billboard.init();
        FullCard.init();
        Nav.init();

        if (Lampa.Storage && Lampa.Storage.listener) {
            Lampa.Storage.listener.follow('change', function (e) {
                if (e.name && isSettingKey(e.name)) applyAll();
            });
        }

        console.log('[NFX Billboard] v' + VERSION + ' ready');
    }

    function start() {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') bootstrap();
        });
        setTimeout(bootstrap, 800);
    }

    if (window.Lampa && Lampa.Listener) {
        start();
    } else {
        var poll = setInterval(function () {
            if (typeof Lampa !== 'undefined' && Lampa.Listener) {
                clearInterval(poll);
                start();
            }
        }, 200);
    }

})();
