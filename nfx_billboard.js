(function () {
    'use strict';

    /* ================================================================
     *  NFX Billboard — v3.4
     *  Інтерфейс Lampa у стилі Netflix TV (стандартний інтерфейс).
     *
     *  Написано з нуля за розбором відео Netflix та опису механіки.
     *
     *  Механіка каруселі (розділи 1–3, 6 опису):
     *    Offset = X_start − I_active × (W_normal + S)
     *    Ліва межа активної картки прибита до X_start і не рухається.
     *    Картка росте вправо реальною зміною ширини (не scaleX).
     *    Зсув ряду і зміна ширини — один анімаційний блок, пружина
     *    .spring(response 0.35, damping 0.85).
     *    Важкі ефекти — через debounce 170 мс.
     *
     *  Ambient (розділ 4): домінантний колір постера, градієнт на фоні,
     *    перехід 0.5 с, оновлення тільки після зупинки фокуса.
     * ================================================================ */

    var ID = 'nfx_billboard';
    var VERSION = '3.4';
    var CSS_ID = 'nfx-billboard-css';

    var DEBOUNCE = 170;          // затримка важких ефектів (розділ 6)
    var SPRING_RESPONSE = 0.35;
    var SPRING_DAMPING = 0.85;
    var FALLBACK_EASE = 'cubic-bezier(0.16, 0.84, 0.28, 1)';

    // Геометрія: кадр 16:9 і постер 2:3 однакової висоти
    var WIDE_TO_POSTER = 3 / 8;      // постер = кадр × 3/8
    var POSTER_TO_WIDE = 8 / 3;
    var POSTER_RATIO = 1.5;          // висота постера = ширина × 1.5

    // =================================================================
    //  Утиліти
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

    function anim() {
        var v = parseInt(S('nfx_speed', '380'), 10);
        return isNaN(v) ? 380 : v;
    }

    function img(path, size) {
        if (!path) return '';
        try { return Lampa.TMDB.image('t/p/' + size + path); } catch (e) { return ''; }
    }

    function el(tag, cls) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        return n;
    }

    function drop(node) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
    }

    function node(x) {
        if (!x) return null;
        return x.nodeType ? x : (x[0] || null);
    }

    function press(n) {
        if (!n) return;
        try { $(n).trigger('hover:enter'); return; } catch (e) { /* ignore */ }
        try { n.dispatchEvent(new CustomEvent('hover:enter', { bubbles: true })); } catch (e) { /* ignore */ }
    }

    function onEnter(n, fn) {
        try { $(n).on('hover:enter', fn); } catch (e) { /* ignore */ }
        n.addEventListener('hover:enter', fn);
        n.addEventListener('click', fn);
    }

    /**
     * CSS-крива з рівняння згасаючої пружини.
     * Netflix не використовує ease-in-out — рух пружний, але без
     * тремтіння. У CSS це linear() із семплів пружини; старий WebKit
     * її не знає, тому поруч завжди пишемо запасну cubic-bezier.
     */
    function spring(ms) {
        var z = SPRING_DAMPING;
        var w0 = 2 * Math.PI / SPRING_RESPONSE;
        var wd = w0 * Math.sqrt(1 - z * z);
        var dur = ms / 1000;
        var out = [];
        var steps = 30;

        for (var i = 0; i <= steps; i++) {
            var t = dur * i / steps;
            var v = 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
            out.push(Math.round(v * 10000) / 10000);
        }

        out[steps] = 1;
        return 'linear(' + out.join(',') + ')';
    }

    /** Пишемо запасну криву, потім пружину — невалідна не застосується */
    function ease(target, prop, ms) {
        target.style[prop] = ms + 'ms ' + FALLBACK_EASE;
        target.style[prop] = ms + 'ms ' + spring(ms);
    }

    // =================================================================
    //  Домінантний колір постера (розділ 4)
    //  Постер малюється в канвас 1×1 — це один семпл, а не аналіз
    //  пікселів, тому дешево навіть для Apple TV.
    // =================================================================

    var Palette = {
        cache: {},

        get: function (url, done) {
            if (!url) return done(null);
            if (this.cache[url] !== undefined) return done(this.cache[url]);

            var key = 'nfxc_color_' + url.slice(-28);
            var stored = S(key, null);
            if (stored) {
                this.cache[url] = stored === 'none' ? null : stored;
                return done(this.cache[url]);
            }

            var self = this;
            var image = new Image();

            image.crossOrigin = 'anonymous';

            image.onload = function () {
                var color = null;

                try {
                    var c = document.createElement('canvas');
                    c.width = 1;
                    c.height = 1;
                    var g = c.getContext('2d');
                    g.drawImage(image, 0, 0, 1, 1);
                    var d = g.getImageData(0, 0, 1, 1).data;
                    color = 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
                } catch (e) {
                    // хост картинок не віддає CORS — канвас «брудний»
                    color = null;
                }

                self.cache[url] = color;
                try { Lampa.Storage.set(key, color || 'none'); } catch (e) { /* ignore */ }
                done(color);
            };

            image.onerror = function () {
                self.cache[url] = null;
                done(null);
            };

            image.src = url;
        }
    };

    // =================================================================
    //  Ambient — фонове світіння під колір активного тайтлу
    // =================================================================

    var Ambient = {
        box: null,

        mode: function () {
            return S('nfx_bg', 'ambient');
        },

        ensure: function () {
            if (this.box) return this.box;

            var b = el('div', 'nfx-amb');
            b.appendChild(el('div', 'nfx-amb__layer'));
            document.body.insertBefore(b, document.body.firstChild);

            this.box = b;
            return b;
        },

        clear: function () {
            drop(this.box);
            this.box = null;
        },

        apply: function (data) {
            if (this.mode() !== 'ambient' || !data) return;

            var self = this;
            var url = img(data.poster_path, 'w92') || img(data.backdrop_path, 'w300');

            Palette.get(url, function (color) {
                if (!color || self.mode() !== 'ambient') return;
                var layer = self.ensure().querySelector('.nfx-amb__layer');
                layer.style.background =
                    'radial-gradient(120% 90% at 18% 12%, ' + color + ' 0%, rgba(0,0,0,0) 62%)';
            });
        }
    };

    // =================================================================
    //  Жанри TMDB
    // =================================================================

    var Genres = {
        map: {},
        busy: {},

        load: function (type) {
            var l = lang();
            var key = 'nfxc_genres_' + type + '_' + l;
            var cached = S(key, null);

            if (cached && typeof cached === 'object') {
                this.map[type] = cached;
                return;
            }
            if (this.busy[key]) return;
            this.busy[key] = true;

            var self = this;
            var url;

            try {
                url = Lampa.TMDB.api('genre/' + type + '/list?api_key=' + Lampa.TMDB.key() + '&language=' + l);
            } catch (e) { this.busy[key] = false; return; }

            $.get(url, function (res) {
                var m = {};
                if (res && res.genres) {
                    for (var i = 0; i < res.genres.length; i++) m[res.genres[i].id] = res.genres[i].name;
                }
                self.map[type] = m;
                self.busy[key] = false;
                try { Lampa.Storage.set(key, m); } catch (e) { /* ignore */ }
            }).fail(function () { self.busy[key] = false; });
        },

        all: function () {
            this.load('movie');
            this.load('tv');
        },

        names: function (type, ids, limit) {
            var m = this.map[type];
            var out = [];
            if (!m || !ids) return out;
            for (var i = 0; i < ids.length && out.length < (limit || 3); i++) {
                if (m[ids[i]]) out.push(m[ids[i]]);
            }
            return out;
        }
    };

    // =================================================================
    //  Логотип тайтлу для кадру 16:9
    // =================================================================

    var Logo = {
        key: function (type, id, l) { return 'nfxc_logo_' + type + '_' + id + '_' + l; },

        cached: function (k) {
            try {
                var v = sessionStorage.getItem(k);
                if (v) return v;
            } catch (e) { /* ignore */ }
            return S(k, null);
        },

        store: function (k, v) {
            var val = v || 'none';
            try { sessionStorage.setItem(k, val); } catch (e) { /* ignore */ }
            try { Lampa.Storage.set(k, val); } catch (e) { /* ignore */ }
        },

        pick: function (list, target) {
            if (!list || !list.length) return null;

            var sorted = list.slice().sort(function (a, b) {
                var x = (a.file_path || '').toLowerCase().indexOf('.svg') > -1;
                var y = (b.file_path || '').toLowerCase().indexOf('.svg') > -1;
                return x === y ? 0 : (x ? 1 : -1);
            });

            var order = target === 'en' ? ['en'] : [target, 'en'];

            for (var j = 0; j < order.length; j++) {
                for (var i = 0; i < sorted.length; i++) {
                    if (sorted[i].iso_639_1 === order[j] && sorted[i].file_path) return sorted[i].file_path;
                }
            }
            return sorted[0] && sorted[0].file_path ? sorted[0].file_path : null;
        },

        mount: function (box, data) {
            if (!data || !data.id) return;

            var type = data.name ? 'tv' : 'movie';
            var l = S('nfx_logo_lang', 'uk') === 'en' ? 'en' : 'uk';
            var k = this.key(type, data.id, l);
            var hit = this.cached(k);

            var put = function (url) {
                if (!url || !box.parentNode) return;
                var i = el('img', 'nfx-hero__logo-img');
                i.src = url;
                box.appendChild(i);
            };

            if (hit === 'none') return;
            if (hit) return put(hit);

            var self = this;
            var url;

            try {
                url = Lampa.TMDB.api(
                    type + '/' + data.id + '/images?api_key=' + Lampa.TMDB.key() +
                    '&include_image_language=' + (l === 'en' ? 'en,null' : l + ',en,null')
                );
            } catch (e) { return; }

            $.get(url, function (res) {
                var path = self.pick(res && res.logos, l);
                if (!path) return self.store(k, null);
                var full = img(path.replace('.svg', '.png'), 'w300');
                self.store(k, full);
                put(full);
            });
        }
    };

    // =================================================================
    //  Ряд-білборд
    // =================================================================

    var Row = {
        line: null,
        ctx: null,

        meta: function (data) {
            var isTv = !!data.name;
            var parts = Genres.names(isTv ? 'tv' : 'movie', data.genre_ids, 3);
            var date = data.release_date || data.first_air_date || '';

            if (date) parts.push(date.slice(0, 4));
            if (data.number_of_seasons) parts.push(data.number_of_seasons + ' сез.');

            return parts.join('  ·  ');
        },

        // ── вміст нерухомої рамки ─────────────────────────────────────
        //  Кадри тайтлів перетікають по прозорості в одній і тій самій
        //  рамці. Саме так це зроблено в Netflix: рамка не рухається і
        //  не змінює розмір, змінюється тільки її вміст.
        pane: function () {
            var p = el('div', 'nfx-pane');
            p.appendChild(el('img', 'nfx-pane__img'));
            p.appendChild(el('div', 'nfx-pane__shade'));
            p.appendChild(el('div', 'nfx-pane__badges'));
            p.appendChild(el('div', 'nfx-pane__logo'));
            return p;
        },

        /**
         * Бейджі (якість, рейтинг, UA — їх малює Lampa або інші плагіни)
         * живуть у .card__view. Сама картка під рамкою не малюється, тому
         * копії бейджів кладемо в панель: координати збігаються, бо панель
         * має рівно ті самі межі, що й розгорнута картка.
         */
        badges: function (pane, cardEl) {
            var box = pane.querySelector('.nfx-pane__badges');
            box.innerHTML = '';

            var view = cardEl && cardEl.querySelector('.card__view');
            if (!view) return;

            var kids = view.children;
            for (var i = 0; i < kids.length; i++) {
                var n = kids[i];
                if (n.classList.contains('card__img')) continue;
                if (n.className && String(n.className).indexOf('nfx-') === 0) continue;
                if (n.tagName === 'IMG') continue;
                box.appendChild(n.cloneNode(true));
            }
        },

        show: function (ctx, data, cardEl) {
            if (!ctx.frame) return;

            var panes = ctx.frame.querySelectorAll('.nfx-pane');
            if (panes.length < 2) return;

            var cur = ctx.pane || 0;
            var next = (cur + 1) % 2;
            var to = panes[next];

            var pic = to.querySelector('.nfx-pane__img');
            pic.src = img(data.backdrop_path, 'w780') || img(data.poster_path, 'w500');

            this.badges(to, cardEl);

            var logo = to.querySelector('.nfx-pane__logo');
            logo.innerHTML = '';
            Logo.mount(logo, data);

            panes[cur].classList.remove('nfx-pane--on');
            to.classList.add('nfx-pane--on');

            ctx.pane = next;
        },

        // ── блок опису під рядом ──────────────────────────────────────
        infoBox: function (lineEl) {
            var box = el('div', 'nfx-info');
            var layers = [];

            for (var i = 0; i < 2; i++) {
                var l = el('div', 'nfx-info__layer' + (i ? '' : ' nfx-info__layer--on'));
                l.appendChild(el('div', 'nfx-info__meta'));
                l.appendChild(el('div', 'nfx-info__text'));
                box.appendChild(l);
                layers.push(l);
            }

            var body = lineEl.querySelector('.items-line__body');
            if (body && body.parentNode) body.parentNode.insertBefore(box, body.nextSibling);
            else lineEl.appendChild(box);

            return { box: box, layers: layers, i: 0, first: true };
        },

        info: function (info, data) {
            if (!info) return;

            var to;

            if (info.first) {
                info.first = false;
                to = info.layers[info.i];
            } else {
                to = info.layers[(info.i + 1) % 2];
                info.layers[info.i].classList.remove('nfx-info__layer--on');
                to.classList.add('nfx-info__layer--on');
                info.i = (info.i + 1) % 2;
            }

            to.querySelector('.nfx-info__meta').textContent = this.meta(data);
            to.querySelector('.nfx-info__text').textContent = data.overview || '';
        },

        // ── підключення ───────────────────────────────────────────────
        attach: function (line) {
            if (!line || this.ctx) return;

            var self = this;
            var lineEl = line.render(true);

            lineEl.classList.add('items-line--nfx');

            var ctx = {
                line: line,
                lineEl: lineEl,
                info: isOn('nfx_info', true) ? this.infoBox(lineEl) : null,
                frame: null,
                m: null,           // геометрія, заміряна один раз у спокої
                index: 0,
                active: null,
                ready: false,
                tDebounce: null,
                tSettle: null,
                tPoll: null
            };

            ctx.body = function () {
                return lineEl.querySelector('.items-line__body .scroll__body');
            };

            ctx.cards = function () {
                return lineEl.querySelectorAll('.items-line__body .card');
            };

            /** Поточний зсув ряду в пікселях */
            ctx.translate = function () {
                var b = ctx.body();
                if (!b) return 0;
                var m = /translate3d\((-?[\d.]+)px/.exec(b.style.transform || '');
                return m ? parseFloat(m[1]) : 0;
            };

            /**
             * Єдиний замір, з якого виводиться вся геометрія.
             * Робиться в спокої, поки жодна картка не розгорнута, тому
             * не залежить від стану анімації.
             */
            ctx.measure = function () {
                if (ctx.m) return ctx.m;

                var cards = ctx.cards();
                if (cards.length < 2) return null;

                // будь-яка пара сусідніх ЗГОРНУТИХ карток: після зміни
                // налаштувань перша картка може бути ще розгорнута, і
                // жорстка перевірка cards[0]/cards[1] лишала ряд без рамки
                var a0 = null, b0 = null;
                for (var i = 0; i + 1 < cards.length; i++) {
                    if (cards[i].classList.contains('nfx-open')) continue;
                    if (cards[i + 1].classList.contains('nfx-open')) continue;
                    if (cards[i + 1].offsetLeft - cards[i].offsetLeft <= 0) continue;
                    a0 = cards[i];
                    b0 = cards[i + 1];
                    break;
                }
                if (!a0) return null;

                var step = b0.offsetLeft - a0.offsetLeft;
                var w = a0.offsetWidth;
                if (step <= 0 || w <= 0) return null;

                var box = lineEl.querySelector('.items-line__body');
                var a = cards[0].getBoundingClientRect();
                var b = box.getBoundingClientRect();
                if (!a.width || !b.width) return null;

                // X_start рахуємо без урахування поточного зсуву ряду.
                // Якщо міряти «як є», а ряд уже прокручений (так буває
                // одразу після перепідключення), рамка їде за екран —
                // саме через це слот 16:9 лишався порожнім.
                var x = a.left - b.left - ctx.translate();
                var y = a.top - b.top;
                var wide = Math.round(w * POSTER_TO_WIDE);

                // заміри під час недоладнаної верстки відкидаємо
                if (w < 20 || step < w || x < -2 || x > b.width * 0.5) return null;
                if (wide > b.width) return null;

                ctx.m = { step: step, w: w, wide: wide, h: Math.round(w * POSTER_RATIO), x: x, y: y };

                return ctx.m;
            };

            /** Offset = −(I × (W + S)) */
            ctx.offset = function (index) {
                var m = ctx.measure();
                if (!m || index < 0) return null;
                return -(index * m.step);
            };

            /**
             * @param mode 'anim'  — з пружиною
             *             'hard'  — миттєво (перше відкриття)
             *             'keep'  — лише поправити ціль, не чіпаючи поточний
             *                       перехід. Саме це потрібно, коли Lampa
             *                       смикає ряд посеред анімації: скидання
             *                       transition у 'none' давало ривок.
             */
            ctx.setOffset = function (index, mode) {
                if (S('nfx_pin', 'left') !== 'left') return;

                var body = ctx.body();
                var to = ctx.offset(index);
                if (!body || to === null) return;

                if (mode === 'anim') {
                    ease(body, 'transition', anim());
                    body.style.transitionProperty = 'transform';
                } else if (mode === 'hard') {
                    body.style.transition = 'none';
                    body.style.transitionProperty = 'none';
                }

                var value = 'translate3d(' + to + 'px, 0px, 0px)';
                if (body.style.transform === value) return;

                body.style.transform = value;
                body.style.webkitTransform = value;
            };

            /**
             * Lampa веде власний scroll_position і, коли сама викликає
             * update (дозавантаження карток, resize), повертає ряд на
             * своє значення. Тоді картка їде, а нерухома рамка лишається
             * на місці — саме цей розсинхрон і був видимим глюком.
             * Обгортаємо update: даємо Lampa відпрацювати свою логіку,
             * але позицію одразу повертаємо нашу.
             */
            ctx.guard = function () {
                var scroll = line.scroll;
                if (!scroll || !scroll.update || scroll.__nfx) return;

                var orig = scroll.update;
                scroll.__nfx = orig;

                scroll.update = function (elem, center) {
                    try { orig.call(scroll, elem, center); } catch (e) { /* ignore */ }
                    // 'keep': поточний перехід не переривається
                    if (ctx.m) ctx.setOffset(ctx.index, 'keep');
                };
            };

            ctx.unguard = function () {
                var scroll = line.scroll;
                if (scroll && scroll.__nfx) {
                    scroll.update = scroll.__nfx;
                    delete scroll.__nfx;
                }
            };

            /** Рамка ставиться з константних величин, не з анімованої картки */
            ctx.placeFrame = function () {
                var m = ctx.measure();
                if (!m) return;

                if (!ctx.frame) {
                    var f = el('div', 'nfx-frame');
                    f.appendChild(self.pane());
                    f.appendChild(self.pane());
                    f.appendChild(el('div', 'nfx-frame__stroke'));
                    lineEl.querySelector('.items-line__body').appendChild(f);
                    ctx.frame = f;
                    ctx.pane = 1;   // перший show() заповнить панель 0
                }

                ctx.frame.style.left = m.x + 'px';
                ctx.frame.style.top = m.y + 'px';
                ctx.frame.style.width = m.wide + 'px';
                ctx.frame.style.height = m.h + 'px';
            };

            ctx.showFrame = function (on) {
                if (!ctx.frame) return;
                if (on) ctx.frame.classList.add('nfx-frame--on');
                else ctx.frame.classList.remove('nfx-frame--on');
            };

            /** Згортання: картка знову стає звичайним постером */
            ctx.collapse = function () {
                if (!ctx.active) return;
                ctx.active.classList.remove('nfx-open');
                ctx.active = null;
            };

            /** Важка частина — тільки після зупинки фокуса */
            /** Якщо рамки немає або вона з битою геометрією — переміряти */
            ctx.heal = function () {
                var bad = !ctx.frame || parseFloat(ctx.frame.style.width || 0) < 20;
                if (!bad) return;

                ctx.m = null;
                ctx.placeFrame();

                if (ctx.frame && parseFloat(ctx.frame.style.width || 0) >= 20) return;

                // верстка ще не доїхала — повторюємо, поки не вийде
                clearTimeout(ctx.tHeal);
                ctx.healTries = (ctx.healTries || 0) + 1;
                if (ctx.healTries > 20) return;

                ctx.tHeal = setTimeout(function () {
                    ctx.m = null;
                    ctx.placeFrame();
                    if (ctx.frame) {
                        ctx.showFrame(true);
                        if (ctx.active && ctx.activeData) self.show(ctx, ctx.activeData, ctx.active);
                    }
                    ctx.heal();
                }, 150);
            };

            ctx.expand = function (item) {
                var cardEl = item.render(true);
                if (!cardEl || ctx.active === cardEl) return;

                var data = item.data || cardEl.card_data || {};

                ctx.active = cardEl;
                ctx.activeData = data;
                cardEl.classList.add('nfx-open');

                ctx.placeFrame();
                ctx.heal();
                self.show(ctx, data, cardEl);
                self.info(ctx.info, data);
                Ambient.apply(data);

                ctx.showFrame(true);
            };

            ctx.indexOf = function (item) {
                if (!line.items) return -1;
                for (var i = 0; i < line.items.length; i++) {
                    if (line.items[i] === item) return i;
                }
                return -1;
            };

            /**
             * Реакція на фокус. Легке — миттєво, щоб пульт відгукувався
             * без затримки. Важке — через DEBOUNCE (розділ 6).
             */
            ctx.focus = function (item) {
                if (!item) return;

                var idx = ctx.indexOf(item);
                if (idx < 0) return;

                ctx.index = idx;

                if (!ctx.ready) {
                    if (!ctx.measure()) return;
                    ctx.guard();
                    ctx.setOffset(idx, 'hard');
                    ctx.expand(item);
                    ctx.ready = true;
                    setTimeout(function () { lineEl.classList.add('items-line--nfx-anim'); }, 60);
                    return;
                }

                var now = Date.now();
                var idle = (now - (ctx.lastAt || 0)) > anim() * 0.9;
                ctx.lastAt = now;

                clearTimeout(ctx.tDebounce);

                ctx.collapse();
                ctx.setOffset(idx, 'anim');

                if (idle) {
                    // Одиночний крок: ширина і зсув стартують в одному кадрі
                    // з однією пружиною — це і є «один анімаційний блок».
                    // Раніше розгортання завжди чекало DEBOUNCE, тому
                    // картка доростала після того, як ряд уже став.
                    ctx.expand(item);
                } else {
                    // Утримання кнопки: важке відкладаємо (розділ 6)
                    ctx.showFrame(false);
                    ctx.tDebounce = setTimeout(function () { ctx.expand(item); }, DEBOUNCE);
                }
            };

            ctx.module = {
                onActive: function (item) { ctx.focus(item); },
                onDestroy: function () { self.detach(); }
            };

            line.use(ctx.module);

            var tries = 0;
            ctx.tPoll = setInterval(function () {
                if (ctx.ready || tries++ > 60) return clearInterval(ctx.tPoll);
                if (!line.items || !line.items.length) return;

                // після зміни налаштувань фокус Lampa може стояти не на
                // першій картці — беремо саме її, інакше ряд і рамка
                // розʼїжджаються
                var pick = line.items[0];
                for (var i = 0; i < line.items.length; i++) {
                    var n = line.items[i].render(true);
                    if (n && n.classList.contains('focus')) { pick = line.items[i]; break; }
                }
                ctx.focus(pick);
            }, 100);

            this.ctx = ctx;
        },

        detach: function () {
            var ctx = this.ctx;
            if (!ctx) return;

            clearInterval(ctx.tPoll);
            clearTimeout(ctx.tDebounce);
            clearTimeout(ctx.tSettle);
            clearTimeout(ctx.tHeal);

            ctx.unguard();

            if (ctx.active) ctx.active.classList.remove('nfx-open');

            var body = ctx.body();
            if (body) {
                body.style.transition = '';
                body.style.transform = '';
            }

            if (ctx.info) drop(ctx.info.box);
            drop(ctx.frame);

            ctx.lineEl.classList.remove('items-line--nfx');
            ctx.lineEl.classList.remove('items-line--nfx-anim');

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

        remeasure: function () {
            if (!this.ctx) return;
            this.ctx.m = null;
            if (this.ctx.measure()) {
                this.ctx.placeFrame();
                this.ctx.setOffset(this.ctx.index, 'hard');
            }
        },

        target: function (line) {
            var lineEl = line.render(true);
            if (!lineEl || !lineEl.parentNode) return false;

            var all = lineEl.parentNode.querySelectorAll('.items-line');
            if (!all.length || all[0] !== lineEl) return false;

            if (S('nfx_scope', 'main') === 'main') {
                var act = Lampa.Activity.active();
                if (!act || act.component !== 'main') return false;
            }

            return true;
        },

        init: function () {
            var self = this;
            var t = null;

            window.addEventListener('resize', function () {
                clearTimeout(t);
                t = setTimeout(function () { self.remeasure(); }, 250);
            });

            Lampa.Listener.follow('line', function (e) {
                if (e.type !== 'create') return;

                setTimeout(function () {
                    try {
                        if (!self.target(e.line)) return;
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
    //  Сторінка тайтлу
    // =================================================================

    var FullCard = {
        layer: null,

        on: function () { return S('nfx_full', 'netflix') === 'netflix'; },

        /**
         * Кадр — фіксований шар на все вікно, а не дитина .full-start-new.
         * Контейнер починається під шапкою і не доходить до низу, тому
         * прив'язка до нього завжди лишала смуги згори і знизу.
         */
        ensure: function () {
            if (this.layer) return this.layer;

            var l = el('div', 'nfx-full__bg');
            l.appendChild(el('div', 'nfx-full__shade'));
            document.body.insertBefore(l, document.body.firstChild);

            this.layer = l;
            return l;
        },

        hide: function () {
            document.body.classList.remove('nfx-full-on');
        },

        clear: function () {
            this.hide();
            drop(this.layer);
            this.layer = null;
        },

        process: function (e) {
            if (!this.on()) return;

            var root = node(e.object && e.object.activity && e.object.activity.render());
            var data = e.data && e.data.movie;
            if (!root || !data) return;

            root.classList.add('nfx-full');

            var url = img(data.backdrop_path, 'w1280') || img(data.poster_path, 'w780');
            if (!url) return;

            this.ensure().style.backgroundImage = 'url(' + url + ')';
            document.body.classList.add('nfx-full-on');
        },

        init: function () {
            var self = this;

            Lampa.Listener.follow('full', function (e) {
                if (e.type !== 'complite') return;
                try { self.process(e); } catch (err) { console.log('[NFX] full', err); }
            });

            // залишаємо сторінку тайтлу — кадр гасне
            Lampa.Listener.follow('activity', function (e) {
                if (e.type === 'start' && e.component !== 'full') self.hide();
            });
        }
    };

    // =================================================================
    //  Шапка
    // =================================================================

    var PRESETS = {
        basic: ['main', 'tv', 'movie'],
        plus: ['main', 'tv', 'movie', 'catalog'],
        full: ['main', 'tv', 'movie', 'anime', 'catalog', 'favorite']
    };

    var GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="3"></circle>' +
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

    var Nav = {
        box: null,
        last: null,
        timer: null,

        track: function (n) {
            var self = this;
            var set = function (e) { self.last = (e && e.target) ? e.target : n; };
            try { $(n).on('hover:focus hover:hover hover:touch', set); } catch (e) { /* ignore */ }
            n.addEventListener('hover:focus', set);
        },

        mark: function (action) {
            if (!this.box) return;
            var tabs = this.box.querySelectorAll('.nfx-nav__tab');
            for (var i = 0; i < tabs.length; i++) {
                if (tabs[i].getAttribute('data-action') === action) tabs[i].classList.add('nfx-nav__tab--on');
                else tabs[i].classList.remove('nfx-nav__tab--on');
            }
        },

        build: function () {
            var head = document.querySelector('.head .head__body');
            if (!head) return false;
            if (!document.querySelector('.menu__item[data-action="main"]')) return false;

            var self = this;
            var nav = el('div', 'nfx-nav');
            var group = el('div', 'nfx-nav__group');

            nav.appendChild(group);
            head.appendChild(nav);
            this.box = nav;

            var search = document.querySelector('.head__action.open--search');
            if (search) {
                search.classList.add('nfx-nav__search');
                group.appendChild(search);
                this.track(search);
            }

            var actions = PRESETS[S('nfx_nav_items', 'basic')] || PRESETS.basic;

            actions.forEach(function (action) {
                var src = document.querySelector('.menu__item[data-action="' + action + '"]');
                if (!src) return;

                var label = src.querySelector('.menu__text');
                var tab = el('div', 'nfx-nav__tab selector');
                tab.setAttribute('data-action', action);
                tab.textContent = label ? label.textContent.trim() : action;

                onEnter(tab, function () {
                    self.mark(action);
                    press(src);
                });
                self.track(tab);
                group.appendChild(tab);
            });

            var gear = document.querySelector('.menu__item[data-action="settings"]');
            var btn = el('div', 'nfx-nav__gear selector');
            btn.innerHTML = GEAR;
            onEnter(btn, function () {
                if (gear) press(gear);
                else if (window.Lampa && Lampa.Settings) Lampa.Settings.show({ category: 'main' });
            });
            this.track(btn);
            group.appendChild(btn);

            this.mark('main');
            document.body.classList.add('nfx-nav-on');
            return true;
        },

        destroy: function () {
            if (!this.box) return;

            var search = this.box.querySelector('.open--search');
            var actions = document.querySelector('.head .head__actions');
            if (search && actions) {
                search.classList.remove('nfx-nav__search');
                actions.appendChild(search);
            }

            drop(this.box);
            this.box = null;
            this.last = null;
            document.body.classList.remove('nfx-nav-on');
        },

        controller: function () {
            var self = this;
            var head = document.querySelector('.head');
            if (!head) return;

            try {
                Lampa.Controller.add('head', {
                    toggle: function () {
                        Lampa.Controller.collectionSet(head, false, true);
                        Lampa.Controller.collectionFocus(self.last || false, head, true);
                    },
                    right: function () { Navigator.move('right'); },
                    left: function () {
                        if (Navigator.canmove('left')) Navigator.move('left');
                        else if (!self.box) Lampa.Controller.toggle('menu');
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
            if (this.box) this.destroy();

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
                if (e.type === 'start' && e.component === 'main') self.mark('main');
            });
        }
    };

    // =================================================================
    //  CSS
    // =================================================================

    function css() {
        drop(document.getElementById(CSS_ID));

        var wideEm = parseFloat(S('nfx_wide', '34em')) || 34;
        var h = wideEm * 9 / 16;
        var poster = wideEm * WIDE_TO_POSTER;
        var radius = S('nfx_radius', '0.4em');
        var titles = isOn('nfx_titles', false) ? 'block' : 'none';
        var bg = S('nfx_bg', 'ambient');
        var focus = S('nfx_focus', 'shadow');
        var gap = S('nfx_gap', '-1.6em');
        var ms = anim();
        var r = [];

        // Фонові шари (ambient, кадр сторінки тайтлу) лежать фіксовано з
        // z-index 0. Без явного z-index на контенті вони перекривали б
        // рамку 16:9 — саме через це зникала біла обводка.
        r.push('body .wrap, body .head { position: relative; z-index: 1; }');

        /* ── фон ── */
        if (bg === 'black') {
            r.push('body { background-color: #000 !important; }');
            r.push('body .background { display: none !important; }');
        }

        if (bg === 'ambient') {
            r.push('body .background { display: none !important; }');
            // Шар лежить під усім вмістом застосунку. Без явного z-index
            // на .wrap фіксований шар з z-index 0 перекривав рамку 16:9,
            // і біла обводка зникала.
            r.push('.nfx-amb { position: fixed; left: 0; top: 0; right: 0; bottom: 0;' +
                ' z-index: 0; pointer-events: none; overflow: hidden; }');
            r.push('body .wrap, body .head { position: relative; z-index: 1; }');
            // маска обовʼязкова, інакше колір «б'є» в очі (розділ 4)
            r.push('.nfx-amb__layer { position: absolute; left: 0; top: 0; right: 0; bottom: 0;' +
                ' opacity: 0.45;' +
                ' -webkit-transition: background 0.5s ease-in-out; transition: background 0.5s ease-in-out; }');
        }

        /* ── шапка ── */
        r.push('.nfx-nav { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; min-width: 0; }');
        r.push('.nfx-nav__group { display: flex; align-items: center; max-width: 100%; overflow: hidden; }');
        r.push('.nfx-nav__search { width: 2.2em; height: 2.2em; margin: 0 0.6em 0 0; padding: 0 !important;' +
            ' display: flex !important; align-items: center; justify-content: center;' +
            ' border-radius: 2em; color: #fff; background: none !important; }');
        r.push('.nfx-nav__search svg { width: 1.35em; height: 1.35em; fill: currentColor; }');
        r.push('.nfx-nav__search.focus { background: #fff !important; color: #000; }');
        r.push('.nfx-nav__tab { padding: 0.42em 1.15em; margin: 0 0.15em; border-radius: 2em;' +
            ' font-size: 1.05em; font-weight: 700; color: #fff; white-space: nowrap; background: transparent; }');
        r.push('.nfx-nav__tab--on { background: rgba(255,255,255,0.22); }');
        r.push('.nfx-nav__tab.focus { background: #fff !important; color: #000 !important; }');
        r.push('.nfx-nav__gear { width: 2.2em; height: 2.2em; margin-left: 0.6em;' +
            ' display: flex; align-items: center; justify-content: center;' +
            ' border-radius: 2em; color: #fff; background: transparent; }');
        r.push('.nfx-nav__gear svg { width: 1.35em; height: 1.35em; }');
        r.push('.nfx-nav__gear.focus { background: #fff; color: #000; }');

        r.push('body.nfx-nav-on .head__logo-icon,' +
            ' body.nfx-nav-on .head__menu-icon,' +
            ' body.nfx-nav-on .head__title,' +
            ' body.nfx-nav-on .head__time,' +
            ' body.nfx-nav-on .head__markers,' +
            ' body.nfx-nav-on .head__backward,' +
            ' body.nfx-nav-on .head__actions { display: none !important; }');
        r.push('body.nfx-nav-on .head { box-shadow: none !important; background: none !important; }');
        r.push('body.nfx-nav-on .head__body { justify-content: center; padding-top: 0.7em; padding-bottom: 0.7em; }');
        r.push('body.nfx-nav-on .wrap__left { width: 15em !important; margin-left: -15em !important; }');
        r.push('body.nfx-nav-on:not(.menu--open) .wrap__left { visibility: hidden !important; }');
        r.push('body.nfx-nav-on.menu--always.menu--open .wrap__content { transform: translate3d(15em,0,0) !important; }');

        /* ── ряд ── */
        r.push('.items-line--nfx { padding-bottom: 1.4em !important; margin-top: ' + gap + ' !important; }');
        r.push('.items-line--nfx .items-line__head { margin-bottom: 0.6em !important; }');
        r.push('.items-line--nfx .items-line__body { position: relative; }');
        r.push('.items-line--nfx .card__title, .items-line--nfx .card__age { display: ' + titles + ' !important; }');

        // висота ряду стала: постер 2:3 і кадр 16:9 однакової висоти
        r.push('.items-line--nfx .card { width: ' + poster.toFixed(3) + 'em !important; }');
        r.push('.items-line--nfx .card__view { margin-bottom: 0.3em !important; overflow: hidden;' +
            ' border-radius: ' + radius + '; height: ' + h.toFixed(3) + 'em !important; padding-bottom: 0 !important; }');
        // Ширина картки анімується, а зображення має лишатись постером.
        // Інакше картка, що виходить із рамки, візуально «стискається».
        r.push('.items-line--nfx .card__img { border-radius: ' + radius + ';' +
            ' width: ' + poster.toFixed(3) + 'em !important; left: 0 !important;' +
            ' height: ' + h.toFixed(3) + 'em !important; object-fit: cover; }');

        // рідне підстрибування Lampa (animation-card-focus) заважає
        r.push('.items-line--nfx .card.focus .card__view,' +
            ' .items-line--nfx .card.hover .card__view,' +
            ' .items-line--nfx .card.animate-trigger-enter .card__view {' +
            ' animation: none !important; -webkit-animation: none !important; }');

        // ширина і зсув ряду — один анімаційний блок, спільна пружина
        r.push('.items-line--nfx-anim .card { transition: width ' + ms + 'ms ' + FALLBACK_EASE + '; }');
        r.push('.items-line--nfx-anim .card { transition: width ' + ms + 'ms ' + spring(ms) + '; }');

        r.push('.items-line--nfx .card.nfx-open { width: ' + wideEm + 'em !important; }');
        // Слот під рамкою не малюється: показ веде сама рамка.
        // Інакше картка, що росте і їде, «вискакувала» з-під рамки.
        r.push('.items-line--nfx .card.nfx-open .card__view { visibility: hidden; }');

        /* ── нерухома рамка ── */
        r.push('.nfx-frame { position: absolute; z-index: 6; pointer-events: none; opacity: 0;' +
            ' background: #000; overflow: hidden; border-radius: ' + radius + ';' +
            ' -webkit-transition: opacity 0.2s ease; transition: opacity 0.2s ease; }');
        r.push('.nfx-frame--on { opacity: 1; }');

        // дві панелі, що перетікають по прозорості
        r.push('.nfx-pane { position: absolute; left: 0; top: 0; right: 0; bottom: 0; opacity: 0;' +
            ' -webkit-transition: opacity ' + ms + 'ms ease; transition: opacity ' + ms + 'ms ease; }');
        r.push('.nfx-pane--on { opacity: 1; }');
        r.push('.nfx-pane__img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }');
        r.push('.nfx-pane__shade { position: absolute; left: 0; right: 0; bottom: 0; height: 55%;' +
            ' background: -webkit-linear-gradient(top, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%);' +
            ' background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%); }');
        r.push('.nfx-pane__badges { position: absolute; left: 0; top: 0; right: 0; bottom: 0;' +
            ' pointer-events: none; }');
        r.push('.nfx-pane__logo { position: absolute; left: 0.9em; bottom: 0.8em;' +
            ' max-width: ' + (poster * 0.8).toFixed(2) + 'em;' +
            ' max-height: ' + (poster * 0.30).toFixed(2) + 'em;' +
            ' display: flex; align-items: flex-end; }');
        r.push('.nfx-hero__logo-img { max-width: 100%; max-height: 100%; width: auto; height: auto;' +
            ' object-fit: contain; object-position: left bottom;' +
            ' filter: drop-shadow(0 2px 10px rgba(0,0,0,0.8)); }');

        // обводка поверх панелей, тому не блимає під час перетікання
        r.push('.nfx-frame__stroke { position: absolute; left: 0; top: 0; right: 0; bottom: 0; z-index: 3;' +
            ' border-radius: ' + radius + '; border: 0.14em solid #fff; }');

        if (focus !== 'stroke') {
            r.push('.nfx-frame { box-shadow: 0 1.2em 3em rgba(0,0,0,0.75), 0 0 1.4em rgba(0,0,0,0.55); }');
        }
        if (focus === 'dim') {
            r.push('.items-line--nfx .card:not(.nfx-open) .card__view { filter: brightness(0.72); }');
        }

        /* ── блок під рядом ── */
        r.push('.nfx-info { position: relative; margin: 0.1em 0 0 0; padding: 0 1.5em; min-height: 6.6em; }');
        r.push('.nfx-info__layer { position: absolute; left: 1.5em; right: 1.5em; top: 0; opacity: 0;' +
            ' pointer-events: none;' +
            ' -webkit-transition: opacity 0.3s ease; transition: opacity 0.3s ease; }');
        r.push('.nfx-info__layer--on { opacity: 1; }');
        r.push('.nfx-info__meta { font-size: 1.05em; font-weight: 600; line-height: 1.3;' +
            ' color: rgba(255,255,255,0.9); margin-bottom: 0.3em; }');
        r.push('.nfx-info__text { font-size: 1.05em; line-height: 1.4; max-width: 46em;' +
            ' color: rgba(255,255,255,0.7);' +
            ' display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }');

        /* ── сторінка тайтлу ── */
        if (S('nfx_full', 'netflix') === 'netflix') {
            // фіксований шар на все вікно — жодних чорних смуг
            r.push('.nfx-full__bg { position: fixed; left: 0; top: 0; right: 0; bottom: 0;' +
                ' z-index: 0; pointer-events: none; opacity: 0;' +
                ' background-size: cover; background-position: center center;' +
                ' -webkit-transition: opacity 0.35s ease; transition: opacity 0.35s ease; }');
            r.push('body.nfx-full-on .nfx-full__bg { opacity: 1; }');
            r.push('.nfx-full__shade { position: absolute; left: 0; top: 0; right: 0; bottom: 0;' +
                ' background: -webkit-linear-gradient(top, rgba(0,0,0,0) 35%, rgba(0,0,0,0.9) 100%);' +
                ' background: linear-gradient(to bottom, rgba(0,0,0,0) 35%, rgba(0,0,0,0.9) 100%); }');

            r.push('.nfx-full .full-start-new, .nfx-full .full-start { position: relative; background: none !important; }');
            r.push('.nfx-full .full-start-new__background, .nfx-full .full-start__background { display: none !important; }');
            r.push('.nfx-full .full-start-new::before, .nfx-full .full-start::before,' +
                ' .nfx-full .full-start-new::after, .nfx-full .full-start::after { display: none !important; }');
            r.push('.nfx-full .applecation__overlay, .nfx-full .application__overlay { display: none !important; }');

            r.push('.nfx-full .full-start-new__left, .nfx-full .full-start__left { display: none !important; }');
            r.push('.nfx-full .full-start-new__reactions, .nfx-full .full-start__reactions { display: none !important; }');
            r.push('.nfx-full .full-start-new__body, .nfx-full .full-start__body {' +
                ' position: relative; z-index: 2; display: flex; align-items: flex-end;' +
                ' min-height: 82vh; padding-left: 4%; padding-top: 6em; padding-bottom: 2em; }');
            r.push('.nfx-full .full-start-new__right, .nfx-full .full-start__right {' +
                ' position: relative; z-index: 3; max-width: 46em;' +
                ' display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-end; }');

            r.push('.nfx-full .full-start__button, .nfx-full .full-start-new__button {' +
                ' border-radius: 2em; border: none; font-weight: 700;' +
                ' background: rgba(255,255,255,0.28); color: #fff; }');
            r.push('.nfx-full .full-start__button svg, .nfx-full .full-start-new__button svg {' +
                ' fill: currentColor; stroke: currentColor; }');
            r.push('.nfx-full .full-start__button.focus, .nfx-full .full-start-new__button.focus {' +
                ' background: #fff !important; color: #000 !important; }');
            r.push('.nfx-full .full-start__button.focus *, .nfx-full .full-start-new__button.focus * {' +
                ' color: #000 !important; fill: #000 !important; stroke: #000 !important; }');
        }

        r.push('@media screen and (max-width: 767px) {' +
            ' .nfx-info { min-height: 5.8em; padding: 0 1em; }' +
            ' .nfx-info__layer { left: 1em; right: 1em; }' +
            ' .nfx-nav__tab { font-size: 0.95em; padding: 0.35em 0.8em; } }');

        var style = document.createElement('style');
        style.id = CSS_ID;
        style.textContent = r.join('\n');
        document.head.appendChild(style);
    }

    // =================================================================
    //  Застосування налаштувань
    // =================================================================

    var KEYS = [
        'nfx_nav', 'nfx_nav_items', 'nfx_bg', 'nfx_full', 'nfx_radius', 'nfx_titles',
        'nfx_row', 'nfx_scope', 'nfx_pin', 'nfx_wide', 'nfx_info', 'nfx_speed',
        'nfx_focus', 'nfx_logo_lang', 'nfx_gap'
    ];

    var applyTimer = null;

    /** SettingsApi.onChange і Storage.change приходять парою — склеюємо */
    function apply() {
        clearTimeout(applyTimer);
        applyTimer = setTimeout(function () {
            css();
            if (S('nfx_bg', 'ambient') !== 'ambient') Ambient.clear();
            if (S('nfx_full', 'netflix') !== 'netflix') FullCard.clear();
            Nav.sync();
            Row.sync();
        }, 120);
    }

    // =================================================================
    //  Налаштування
    // =================================================================

    var I18N = {
        uk: {
            title: 'NFX Billboard',
            nav: 'Шапка в стилі Netflix', nav_items: 'Вкладки в шапці',
            nav_b: 'Головна / Серіали / Фільми', nav_p: '+ Каталог', nav_f: '+ Аніме, Каталог, Обране',
            full: 'Вигляд відкритої картки', full_l: 'Як у Lampa', full_n: 'Netflix (кадр на весь екран)',
            bg: 'Фон', bg_l: 'Як у Lampa', bg_b: 'Чорний', bg_a: 'Ambient (колір тайтлу)',
            speed: 'Швидкість анімації', sp_f: 'Швидко (260 мс)', sp_n: 'Як у Netflix (380 мс)', sp_s: 'Повільно (500 мс)',
            focus: 'Виділення обраної картки', fo_s: 'Тільки обводка', fo_sh: 'Обводка і тінь', fo_d: 'Обводка, тінь, затемнення решти',
            radius: 'Заокруглення кутів', titles: 'Назви під картками',
            gap: 'Відступ ряду від шапки', gap_0: 'Стандартний', gap_1: 'Менший',
            gap_2: 'Малий', gap_3: 'Мінімальний',
            row: 'Увімкнути ряд-білборд', scope: 'Де застосовувати',
            sc_m: 'Тільки головна', sc_a: 'Усі сторінки з рядами',
            pin: 'Позиція фокуса в ряду', pin_l: 'Ліворуч (Netflix)', pin_c: 'По центру (як у Lampa)',
            wide: 'Ширина кадру 16:9', info: 'Блок опису під рядом',
            llang: 'Мова логотипу на кадрі 16:9'
        },
        en: {
            title: 'NFX Billboard',
            nav: 'Netflix-style header', nav_items: 'Header tabs',
            nav_b: 'Home / Series / Movies', nav_p: '+ Catalog', nav_f: '+ Anime, Catalog, Favorites',
            full: 'Opened card look', full_l: 'Lampa default', full_n: 'Netflix (full-bleed backdrop)',
            bg: 'Background', bg_l: 'Lampa default', bg_b: 'Black', bg_a: 'Ambient (title colour)',
            speed: 'Animation speed', sp_f: 'Fast (260 ms)', sp_n: 'Netflix (380 ms)', sp_s: 'Slow (500 ms)',
            focus: 'Selected card emphasis', fo_s: 'Stroke only', fo_sh: 'Stroke and shadow', fo_d: 'Stroke, shadow, dim the rest',
            radius: 'Corner radius', titles: 'Titles under cards',
            gap: 'Row offset from header', gap_0: 'Default', gap_1: 'Smaller',
            gap_2: 'Small', gap_3: 'Minimal',
            row: 'Enable billboard row', scope: 'Where to apply',
            sc_m: 'Main page only', sc_a: 'All pages with rows',
            pin: 'Focus position in row', pin_l: 'Left (Netflix)', pin_c: 'Center (Lampa default)',
            wide: '16:9 frame width', info: 'Description block under row',
            llang: 'Logo language on the 16:9 frame'
        }
    };

    function settings() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        var d = I18N[lang()] || I18N.en;
        function t(k) { return d[k] || I18N.en[k] || k; }

        Lampa.SettingsApi.addComponent({
            component: ID,
            name: t('title'),
            icon: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="12" height="14" rx="2"></rect><rect x="16" y="8" width="6" height="8" rx="1"></rect></svg>'
        });

        var list = [
            { n: 'nfx_nav', ty: 'trigger', d: true, t: t('nav') },
            { n: 'nfx_nav_items', ty: 'select', d: 'basic', t: t('nav_items'),
              v: { basic: t('nav_b'), plus: t('nav_p'), full: t('nav_f') } },
            { n: 'nfx_full', ty: 'select', d: 'netflix', t: t('full'),
              v: { lampa: t('full_l'), netflix: t('full_n') } },
            { n: 'nfx_bg', ty: 'select', d: 'ambient', t: t('bg'),
              v: { lampa: t('bg_l'), black: t('bg_b'), ambient: t('bg_a') } },
            { n: 'nfx_speed', ty: 'select', d: '380', t: t('speed'),
              v: { '260': t('sp_f'), '380': t('sp_n'), '500': t('sp_s') } },
            { n: 'nfx_focus', ty: 'select', d: 'shadow', t: t('focus'),
              v: { stroke: t('fo_s'), shadow: t('fo_sh'), dim: t('fo_d') } },
            { n: 'nfx_radius', ty: 'select', d: '0.4em', t: t('radius'),
              v: { '0em': '0', '0.4em': '0.4em', '0.8em': '0.8em', '1em': '1em' } },
            { n: 'nfx_titles', ty: 'trigger', d: false, t: t('titles') },
            { n: 'nfx_gap', ty: 'select', d: '-1.6em', t: t('gap'),
              v: { '0em': t('gap_0'), '-1.6em': t('gap_1'), '-3em': t('gap_2'), '-4.5em': t('gap_3') } },
            { n: 'nfx_row', ty: 'trigger', d: true, t: t('row') },
            { n: 'nfx_scope', ty: 'select', d: 'main', t: t('scope'),
              v: { main: t('sc_m'), all: t('sc_a') } },
            { n: 'nfx_pin', ty: 'select', d: 'left', t: t('pin'),
              v: { left: t('pin_l'), center: t('pin_c') } },
            { n: 'nfx_wide', ty: 'select', d: '34em', t: t('wide'),
              v: { '28em': '2.2x', '31em': '2.4x', '34em': '2.7x (16:9)', '38em': '3.0x' } },
            { n: 'nfx_info', ty: 'trigger', d: true, t: t('info') },
            { n: 'nfx_logo_lang', ty: 'select', d: 'uk', t: t('llang'),
              v: { uk: 'Українська', en: 'English' } }
        ];

        list.forEach(function (p) {
            var conf = { name: p.n, type: p.ty, default: p.d };
            if (p.v) conf.values = p.v;

            Lampa.SettingsApi.addParam({
                component: ID,
                param: conf,
                field: { name: p.t },
                onChange: apply
            });
        });
    }

    // =================================================================
    //  Старт
    // =================================================================

    function boot() {
        if (window.__nfx_billboard) return;
        window.__nfx_billboard = true;

        settings();
        css();
        Genres.all();
        Row.init();
        FullCard.init();
        Nav.init();

        if (Lampa.Storage && Lampa.Storage.listener) {
            Lampa.Storage.listener.follow('change', function (e) {
                if (e.name && KEYS.indexOf(e.name) > -1) apply();
            });
        }

        console.log('[NFX Billboard] v' + VERSION + ' ready');
    }

    function start() {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') boot();
        });
        setTimeout(boot, 800);
    }

    if (window.Lampa && Lampa.Listener) start();
    else {
        var poll = setInterval(function () {
            if (typeof Lampa !== 'undefined' && Lampa.Listener) {
                clearInterval(poll);
                start();
            }
        }, 200);
    }

})();
