(function () {
    'use strict';

    /* ================================================================
     *  NFX Billboard — v1.5
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
    var VERSION = '1.5';
    var CSS_ID = 'nfx-billboard-css';

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
    //  2. Логотипи тайтлів (TMDB /images)
    //     Кеш під префіксом nfxc_ — щоб запис у кеш не сприймався
    //     як зміна налаштування.
    // =================================================================

    var LogoEngine = {
        key: function (type, id, l) {
            return 'nfxc_logo_' + type + '_' + id + '_' + l;
        },

        getCached: function (k) {
            try {
                var s = sessionStorage.getItem(k);
                if (s) return s;
            } catch (e) { /* ignore */ }
            return S(k, null);
        },

        setCached: function (k, v) {
            var val = v || 'none';
            try { sessionStorage.setItem(k, val); } catch (e) { /* ignore */ }
            try { Lampa.Storage.set(k, val); } catch (e) { /* ignore */ }
        },

        /** Мова логотипу: uk за замовчуванням, або оригінальна мова тайтлу */
        targetLang: function (data) {
            var mode = S('nfx_logo_lang', 'uk');
            if (mode === 'original') return (data && data.original_language) || 'en';
            return mode;
        },

        pick: function (logos, target) {
            if (!logos || !logos.length) return null;

            // PNG стабільніші за SVG на старому WebKit — ставимо першими
            var sorted = logos.slice().sort(function (a, b) {
                var aSvg = (a.file_path || '').toLowerCase().indexOf('.svg') > -1;
                var bSvg = (b.file_path || '').toLowerCase().indexOf('.svg') > -1;
                return aSvg === bSvg ? 0 : (aSvg ? 1 : -1);
            });

            var order = [target];
            if (target === 'uk') order.push('ru');
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
            var l = this.targetLang(data);
            var k = this.key(type, data.id, l);
            var cached = this.getCached(k);

            if (cached === 'none') return done(null);
            if (cached) return done(cached);

            var self = this;
            var url;

            try {
                url = Lampa.TMDB.api(
                    type + '/' + data.id + '/images?api_key=' + Lampa.TMDB.key() +
                    '&include_image_language=' + l + ',ru,en,null'
                );
            } catch (e) { return done(null); }

            $.get(url, function (res) {
                var path = self.pick(res && res.logos, l);
                if (path) {
                    var img = tmdbImage(path.replace('.svg', '.png'), 'w500');
                    self.setCached(k, img);
                    done(img);
                } else {
                    self.setCached(k, 'none');
                    done(null);
                }
            }).fail(function () { done(null); });
        },

        /** Вставити логотип у контейнер; fallback — текстова назва */
        mount: function (box, data, cls) {
            var fallback = el('div', cls + '__name');
            fallback.textContent = data.title || data.name || '';
            box.appendChild(fallback);

            this.resolve(data, function (url) {
                if (!url || !box.parentNode) return;
                var img = el('img', cls + '__img');
                img.onload = function () {
                    if (box.parentNode) fallback.style.display = 'none';
                };
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

        /** Логотип поверх звичайного постера (режим «на всіх картках») */
        mountCardLogo: function (cardEl, data) {
            if (S('nfx_logo', 'open') !== 'all') return;
            if (!cardEl || cardEl.querySelector('.nfx-card-logo')) return;

            var view = cardEl.querySelector('.card__view');
            if (!view) return;

            var box = el('div', 'nfx-card-logo');
            view.appendChild(box);
            LogoEngine.mount(box, data, 'nfx-card-logo');
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

            hero.appendChild(el('div', 'nfx-hero__shade'));

            if (S('nfx_logo', 'open') !== 'off') {
                var logoBox = el('div', 'nfx-hero__logo');
                hero.appendChild(logoBox);
                LogoEngine.mount(logoBox, data, 'nfx-hero__logo');
            }

            // Обводка окремим шаром: inset-тінь на .card__view перекривається
            // вмістом картки, а цей шар лежить поверх усього.
            hero.appendChild(el('div', 'nfx-hero__stroke'));

            // hero кладемо ПІД рідний вміст картки, щоб бейджі інших
            // плагінів лишались видимими
            if (view.firstChild) view.insertBefore(hero, view.firstChild);
            else view.appendChild(hero);
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
                module: null
            };

            ctx.decorate = function () {
                if (S('nfx_logo', 'open') !== 'all' || !line.items) return;
                for (var i = 0; i < line.items.length; i++) {
                    var item = line.items[i];
                    var node = item.render(true);
                    self.mountCardLogo(node, item.data || node.card_data || {});
                }
            };

            ctx.open = function (item) {
                if (!item) return;

                var cardEl = item.render(true);
                if (!cardEl || ctx.current === cardEl) return;

                if (ctx.current) {
                    ctx.current.classList.remove('nfx-open');
                    remove(ctx.current.querySelector('.nfx-hero'));
                }

                ctx.current = cardEl;
                cardEl.classList.add('nfx-open');

                var data = item.data || cardEl.card_data || {};

                self.buildHero(cardEl, data);
                self.renderInfo(ctx.info, data);
                ctx.decorate();

                // ширина міняється миттєво, тому геометрія вже фінальна
                if (S('nfx_pin', 'left') === 'left' && line.scroll) {
                    line.scroll.update(cardEl, false);
                }
            };

            ctx.module = {
                onActive: function (item) { ctx.open(item); },
                onAppend: function () { ctx.decorate(); },
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

            if (ctx.current) {
                ctx.current.classList.remove('nfx-open');
                remove(ctx.current.querySelector('.nfx-hero'));
            }

            if (ctx.info) remove(ctx.info.box);
            if (ctx.lineEl) {
                ctx.lineEl.classList.remove('items-line--nfx');
                var logos = ctx.lineEl.querySelectorAll('.nfx-card-logo');
                for (var i = 0; i < logos.length; i++) remove(logos[i]);
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

            // логотип замість текстового заголовка
            if (S('nfx_logo', 'open') !== 'off') {
                var title = root.querySelector('.full-start-new__title, .full-start__title');
                if (title && !title.querySelector('.nfx-full-logo__img')) {
                    var self = this;
                    LogoEngine.resolve(data, function (logo) {
                        if (!logo || !title.parentNode) return;
                        var img = el('img', 'nfx-full-logo__img');
                        img.onload = function () {
                            if (!title.parentNode) return;
                            title.classList.add('nfx-full-logo');
                            title.textContent = '';
                            title.appendChild(img);
                        };
                        img.src = logo;
                    });
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

        var wide = S('nfx_wide', '34em');
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
        css.push('.items-line--nfx .card__title, .items-line--nfx .card__age { display: ' + titles + ' !important; }');
        css.push('.items-line--nfx .card { transition: none !important; }');
        css.push('.items-line--nfx .card__view { margin-bottom: 0.3em !important; overflow: hidden; border-radius: ' + radius + '; }');
        css.push('.items-line--nfx .card__img { border-radius: ' + radius + '; }');

        // Lampa підстрибує карткою у фокусі (animation-card-focus) — гасимо
        css.push('.items-line--nfx .card.focus .card__view,' +
            ' .items-line--nfx .card.hover .card__view,' +
            ' .items-line--nfx .card.animate-trigger-enter .card__view {' +
            ' animation: none !important; -webkit-animation: none !important; }');

        /* ── розгорнута картка 16:9 ── */
        css.push('.items-line--nfx .card.nfx-open { width: ' + wide + ' !important; }');
        css.push('.items-line--nfx .card.nfx-open .card__view { padding-bottom: 56.25% !important; }');
        css.push('.items-line--nfx .card.nfx-open .card__img { opacity: 0; }');

        css.push('.nfx-hero { position: absolute; left: 0; top: 0; right: 0; bottom: 0;' +
            ' border-radius: ' + radius + '; overflow: hidden; }');
        css.push('.nfx-hero__img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; }');
        css.push('.nfx-hero__shade { position: absolute; left: 0; right: 0; bottom: 0; height: 55%;' +
            ' background: -webkit-linear-gradient(top, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%);' +
            ' background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%); }');

        // біла обводка — окремий шар поверх усього, тому не зникає
        css.push('.nfx-hero__stroke { position: absolute; left: 0; top: 0; right: 0; bottom: 0;' +
            ' z-index: 4; pointer-events: none; border-radius: ' + radius + ';' +
            ' border: 0.14em solid #fff; }');

        css.push('.nfx-hero__logo { position: absolute; left: 1.2em; bottom: 1.1em; z-index: 3;' +
            ' max-width: 60%; max-height: 45%; display: flex; align-items: flex-end; }');
        css.push('.nfx-hero__logo__name { font-size: 1.5em; font-weight: 800; line-height: 1.1; color: #fff;' +
            ' text-shadow: 0 2px 10px rgba(0,0,0,0.85); }');
        css.push('.nfx-hero__logo__img { max-width: 100%; max-height: 5.5em; width: auto; height: auto;' +
            ' object-fit: contain; object-position: left bottom;' +
            ' filter: drop-shadow(0 3px 14px rgba(0,0,0,0.75)); }');

        /* ── логотип поверх звичайних постерів ── */
        css.push('.nfx-card-logo { position: absolute; left: 0.5em; right: 0.5em; bottom: 0.5em; z-index: 3;' +
            ' display: flex; align-items: flex-end; pointer-events: none; }');
        css.push('.nfx-card-logo__name { font-size: 0.9em; font-weight: 800; line-height: 1.1; color: #fff;' +
            ' text-shadow: 0 2px 8px rgba(0,0,0,0.9); }');
        css.push('.nfx-card-logo__img { max-width: 100%; max-height: 3.2em; width: auto; height: auto;' +
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

            // логотип замість заголовка
            css.push('.nfx-full .full-start-new__title.nfx-full-logo,' +
                ' .nfx-full .full-start__title.nfx-full-logo { background: none !important; }');
            css.push('.nfx-full-logo__img { display: block; max-width: 100%; max-height: 7em;' +
                ' width: auto; height: auto; object-fit: contain; object-position: left bottom;' +
                ' filter: drop-shadow(0 4px 18px rgba(0,0,0,0.8)); }');

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
            ' .items-line--nfx .card.nfx-open { width: 22em !important; }' +
            ' .nfx-info { min-height: 5.8em; padding: 0 1em; }' +
            ' .nfx-info__layer { left: 1em; right: 1em; }' +
            ' .nfx-hero__logo__img { max-height: 3.5em; }' +
            ' .nfx-full-logo__img { max-height: 4.5em; }' +
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
        'nfx_info', 'nfx_logo', 'nfx_logo_lang'
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
            logo: 'Логотип тайтлу',
            logo_off: 'Вимкнено',
            logo_open: 'На розгорнутій картці',
            logo_all: 'На всіх картках',
            logo_lang: 'Мова логотипу',
            logo_orig: 'Оригінальна'
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
            logo: 'Логотип тайтла',
            logo_off: 'Выключено',
            logo_open: 'На развёрнутой карточке',
            logo_all: 'На всех карточках',
            logo_lang: 'Язык логотипа',
            logo_orig: 'Оригинальный'
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
            logo: 'Title logo',
            logo_off: 'Off',
            logo_open: 'On expanded card',
            logo_all: 'On every card',
            logo_lang: 'Logo language',
            logo_orig: 'Original'
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

            { name: 'nfx_logo', type: 'select', def: 'open', title: t('logo'),
              values: { off: t('logo_off'), open: t('logo_open'), all: t('logo_all') } },
            { name: 'nfx_logo_lang', type: 'select', def: 'uk', title: t('logo_lang'),
              values: { uk: 'Українська', original: t('logo_orig'), en: 'English', ru: 'Русский' } },

            { name: 'nfx_row', type: 'trigger', def: true, title: t('row') },
            { name: 'nfx_scope', type: 'select', def: 'main', title: t('scope'),
              values: { main: t('scope_main'), all: t('scope_all') } },
            { name: 'nfx_pin', type: 'select', def: 'left', title: t('pin'),
              values: { left: t('pin_left'), center: t('pin_center') } },
            { name: 'nfx_wide', type: 'select', def: '34em', title: t('wide'),
              values: { '28em': '2.2x', '31em': '2.4x', '34em': '2.7x (16:9)', '38em': '3.0x' } },
            { name: 'nfx_info', type: 'trigger', def: true, title: t('info') }
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
