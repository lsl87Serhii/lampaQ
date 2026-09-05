(function () {
    'use strict';

    /* ================================================================
     *  NFX Billboard — v1.4
     *  Netflix-подібний інтерфейс для Lampa (стандартний інтерфейс)
     *
     *  Складові:
     *    A. Шапка: пошук + вкладки + налаштування, по центру екрана
     *    B. Ряд-білборд: перша картка розгортається у 16:9, фокус
     *       прибитий до лівого краю, під рядом — назва/жанри/опис
     *    C. Стилі: фон сторінки, вигляд карток у ряду
     *
     *  Усі налаштування застосовуються без перезапуску.
     *  Побудовано на публічному API Lampa (Listener, Controller,
     *  SettingsApi, Storage, TMDB) — звірено з yumata/lampa-source.
     * ================================================================ */

    var PLUGIN_ID = 'nfx_billboard';
    var VERSION = '1.4';

    var CSS_ID = 'nfx-billboard-css';
    var ACCENT = '#e50914';
    var SCALE = '1.28';

    // =================================================================
    //  0. Дрібні утиліти
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
    //  1. Тип тайтлу — у Lampa немає ключів title_movie / title_tv
    // =================================================================

    var TYPE_WORD = {
        uk: { movie: 'Фільм', tv: 'Серіал' },
        ru: { movie: 'Фильм', tv: 'Сериал' },
        be: { movie: 'Фільм', tv: 'Серыял' },
        en: { movie: 'Movie', tv: 'Series' },
        pl: { movie: 'Film', tv: 'Serial' }
    };

    function typeWord(isTv) {
        var d = TYPE_WORD[lang()] || TYPE_WORD.en;
        return isTv ? d.tv : d.movie;
    }

    // =================================================================
    //  2. Жанри TMDB — один запит на мову/тип, далі з кешу
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

            // не повторюємо запит, поки летить попередній
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
    //  3. Логотипи тайтлів (TMDB /images), кеш у sessionStorage + Storage
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

        pick: function (logos, target) {
            if (!logos || !logos.length) return null;

            // PNG важать менше і не ламаються на старих WebKit — ставимо їх першими
            var sorted = logos.slice().sort(function (a, b) {
                var aSvg = (a.file_path || '').toLowerCase().indexOf('.svg') > -1;
                var bSvg = (b.file_path || '').toLowerCase().indexOf('.svg') > -1;
                return aSvg === bSvg ? 0 : (aSvg ? 1 : -1);
            });

            var order = target === 'uk' ? [target, 'ru', 'en'] : [target, 'en'];
            var i, j;

            for (j = 0; j < order.length; j++) {
                for (i = 0; i < sorted.length; i++) {
                    if (sorted[i].iso_639_1 === order[j] && sorted[i].file_path) return sorted[i].file_path;
                }
            }

            return sorted[0] && sorted[0].file_path ? sorted[0].file_path : null;
        },

        pickLang: function () {
            var manual = S('nfx_logo_lang', 'auto');
            return (manual && manual !== 'auto') ? manual : lang();
        },

        resolve: function (data, done) {
            if (!data || !data.id) return done(null);

            var type = data.name ? 'tv' : 'movie';
            var l = this.pickLang();
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
        }
    };

    // =================================================================
    //  4. Ряд-білборд
    // =================================================================

    var Billboard = {
        line: null,      // Line сторінки, до якої можемо чіплятися
        ctx: null,       // активне підключення

        /* ── мета-рядок: назва · жанри · рік ── */
        meta: function (data) {
            var isTv = !!data.name;
            var parts = [data.title || data.name || typeWord(isTv)];

            var g = Genres.names(isTv ? 'tv' : 'movie', data.genre_ids, 2);
            for (var i = 0; i < g.length; i++) parts.push(g[i]);

            var date = data.release_date || data.first_air_date || '';
            if (date) parts.push(date.slice(0, 4));

            if (data.number_of_seasons) parts.push(data.number_of_seasons + ' сез.');

            return parts.join('  ·  ');
        },

        /* ── вміст розгорнутої картки ── */
        buildHero: function (cardEl, data) {
            var view = cardEl.querySelector('.card__view');
            if (!view) return;

            remove(view.querySelector('.nfx-hero'));

            var hero = el('div', 'nfx-hero');

            var img = el('img', 'nfx-hero__img');
            img.src = tmdbImage(data.backdrop_path, 'w780') || tmdbImage(data.poster_path, 'w500');
            hero.appendChild(img);

            hero.appendChild(el('div', 'nfx-hero__shade'));

            var logoBox = el('div', 'nfx-hero__logo');
            var fallback = el('div', 'nfx-hero__name');
            fallback.textContent = data.title || data.name || '';
            logoBox.appendChild(fallback);
            hero.appendChild(logoBox);

            // hero кладемо ПІД рідний вміст картки — тоді бейджі якості
            // (у т.ч. намальовані іншими плагінами) лишаються зверху
            if (view.firstChild) view.insertBefore(hero, view.firstChild);
            else view.appendChild(hero);

            if (isOn('nfx_logo', true)) {
                LogoEngine.resolve(data, function (url) {
                    if (!url || !hero.parentNode) return;
                    var li = el('img', 'nfx-hero__logo-img');
                    li.onload = function () {
                        if (hero.parentNode) fallback.style.display = 'none';
                    };
                    li.src = url;
                    logoBox.appendChild(li);
                });
            }
        },

        /* ── блок під рядом: два шари для крос-фейду ── */
        buildInfo: function (lineEl) {
            var box = el('div', 'nfx-info');
            var a = el('div', 'nfx-info__layer nfx-info__layer--active');
            var b = el('div', 'nfx-info__layer');
            var i;

            for (i = 0; i < 2; i++) {
                var layer = i === 0 ? a : b;
                layer.appendChild(el('div', 'nfx-info__meta'));
                layer.appendChild(el('div', 'nfx-info__text'));
            }

            box.appendChild(a);
            box.appendChild(b);

            var body = lineEl.querySelector('.items-line__body');
            if (body && body.parentNode) body.parentNode.insertBefore(box, body.nextSibling);
            else lineEl.appendChild(box);

            return { box: box, layers: [a, b], index: 0, first: true };
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

        /* ── підключення / відключення ── */
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

                // ширина міняється миттєво, тому геометрія вже фінальна
                if (S('nfx_pin', 'left') === 'left' && line.scroll) {
                    line.scroll.update(cardEl, false);
                }
            };

            ctx.module = {
                onActive: function (item) { ctx.open(item); },
                onDestroy: function () { self.detach(); }
            };

            line.use(ctx.module);

            // початковий стан — розгорнути першу картку, коли вона зʼявиться
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
            if (ctx.lineEl) ctx.lineEl.classList.remove('items-line--nfx');

            if (ctx.line && ctx.module && ctx.line.components) {
                ctx.line.components = ctx.line.components.filter(function (c) {
                    return c !== ctx.module;
                });
            }

            this.ctx = null;
        },

        /** Привести стан у відповідність до налаштувань (виклик після будь-якої зміни) */
        sync: function () {
            this.detach();
            if (isOn('nfx_row', true) && this.line) this.attach(this.line);
        },

        /** Перший ряд поточної сторінки? */
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

            // пункти беремо з бокового меню — чекаємо, поки воно збудується
            if (!document.querySelector('.menu__item[data-action="main"]')) return false;

            var self = this;
            var nav = el('div', 'nfx-nav');
            var group = el('div', 'nfx-nav__group');

            nav.appendChild(group);
            headBody.appendChild(nav);
            this.node = nav;

            // пошук — переносимо рідну іконку разом з її обробником
            var search = document.querySelector('.head__action.open--search');
            if (search) {
                search.classList.add('nfx-nav__search');
                group.appendChild(search);
                this.trackFocus(search);
            }

            // вкладки
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

            // налаштування Lampa
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

            // повертаємо іконку пошуку на місце
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
                        // з увімкненою шапкою бокове меню приховане — не провалюємось у нього
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
            var want = isOn('nfx_nav', true);

            if (!want) return this.destroy();
            if (this.node) {
                // перебудова: могли змінитись вкладки
                this.destroy();
            }

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
    //  5b. Вигляд карток (premium — як у NFX Premium Style)
    // =================================================================

    var CardStyle = {
        observer: null,
        timer: null,

        enabled: function () {
            return S('nfx_card_style', 'plain') === 'premium';
        },

        /** Крайні картки масштабуються від свого краю, щоб не вилазити за екран */
        tagEdges: function () {
            var rows = document.querySelectorAll('.scroll__body');
            for (var r = 0; r < rows.length; r++) {
                var cards = rows[r].querySelectorAll('.card');
                if (!cards.length) continue;
                for (var c = 0; c < cards.length; c++) cards[c].removeAttribute('data-nfx-edge');
                cards[0].setAttribute('data-nfx-edge', 'first');
                cards[cards.length - 1].setAttribute('data-nfx-edge', 'last');
            }
        },

        start: function () {
            if (this.observer) return;

            var self = this;
            document.body.classList.add('nfx-premium');

            this.observer = new MutationObserver(function () {
                clearTimeout(self.timer);
                self.timer = setTimeout(self.tagEdges, 120);
            });
            this.observer.observe(document.body, { childList: true, subtree: true });

            this.tagEdges();
        },

        stop: function () {
            document.body.classList.remove('nfx-premium');

            if (this.observer) {
                this.observer.disconnect();
                this.observer = null;
            }
            clearTimeout(this.timer);

            var tagged = document.querySelectorAll('[data-nfx-edge]');
            for (var i = 0; i < tagged.length; i++) tagged[i].removeAttribute('data-nfx-edge');
        },

        sync: function () {
            if (this.enabled()) this.start();
            else this.stop();
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
        var premium = S('nfx_card_style', 'plain') === 'premium';
        var blackBg = S('nfx_bg', 'lampa') === 'black';

        var css = [];

        /* ── фон сторінки ── */
        if (blackBg) {
            css.push('body { background-color: #000 !important; }');
            css.push('body .background { display: none !important; }');
        }

        /* ── шапка ── */
        css.push('.nfx-nav { display: flex; align-items: center; justify-content: center; flex: 1 1 auto; min-width: 0; }');
        css.push('.nfx-nav__group { display: flex; align-items: center; justify-content: center; max-width: 100%; overflow: hidden; }');

        css.push('.nfx-nav__search {' +
            ' width: 2.2em; height: 2.2em; margin: 0 0.6em 0 0; padding: 0 !important;' +
            ' display: flex !important; align-items: center; justify-content: center;' +
            ' border-radius: 2em; color: #fff; background: none !important; }');
        css.push('.nfx-nav__search svg { width: 1.35em; height: 1.35em; fill: currentColor; }');
        css.push('.nfx-nav__search.focus, .nfx-nav__search:hover { background: #fff !important; color: #000; }');

        css.push('.nfx-nav__tab {' +
            ' padding: 0.42em 1.15em; margin: 0 0.15em; border-radius: 2em;' +
            ' font-size: 1.05em; font-weight: 700; color: #fff;' +
            ' white-space: nowrap; cursor: pointer; background: transparent; }');
        css.push('.nfx-nav__tab--active { background: rgba(255,255,255,0.22); }');
        css.push('.nfx-nav__tab.focus, .nfx-nav__tab:hover { background: #fff !important; color: #000 !important; }');

        css.push('.nfx-nav__settings {' +
            ' width: 2.2em; height: 2.2em; margin-left: 0.6em;' +
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

        // бокове меню лишається робочим, але прихованим
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
            ' background: -webkit-linear-gradient(top, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%);' +
            ' background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%); }');
        css.push('.nfx-hero__logo { position: absolute; left: 1.2em; bottom: 1.1em;' +
            ' max-width: 55%; max-height: 40%; display: flex; align-items: flex-end; }');
        css.push('.nfx-hero__name { font-size: 1.5em; font-weight: 800; line-height: 1.1; color: #fff;' +
            ' text-shadow: 0 2px 10px rgba(0,0,0,0.8); }');
        css.push('.nfx-hero__logo-img { position: absolute; left: 0; bottom: 0;' +
            ' max-width: 100%; max-height: 5.5em; width: auto; height: auto;' +
            ' object-fit: contain; object-position: left bottom;' +
            ' filter: drop-shadow(0 3px 14px rgba(0,0,0,0.7)); }');
        css.push('.nfx-hero__chips { position: absolute; right: 1em; bottom: 1.1em; display: flex; align-items: center; }');
        css.push('.nfx-chip { margin-left: 0.5em; padding: 0.25em 0.7em; border-radius: 0.3em;' +
            ' font-size: 0.85em; font-weight: 700; color: #fff;' +
            ' background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25); }');

        /* ── біла обводка обраної картки 16:9 (як у Netflix) ── */
        css.push('.items-line--nfx .card.nfx-open .card__view {' +
            ' box-shadow: inset 0 0 0 0.14em rgba(255,255,255,0.95) !important; }');

        /* ── бейджі якості/рейтингу на розгорнутій картці ── */
        if (!isOn('nfx_chips', true)) {
            css.push('.items-line--nfx .card.nfx-open .card__quality,' +
                ' .items-line--nfx .card.nfx-open .card__vote { display: none !important; }');
        }

        /* ── premium: масштаб у фокусі, зсув сусідів, підсвітка ── */
        if (premium) {
            // нічого не має обрізати збільшену картку
            css.push('body.nfx-premium .items-line,' +
                ' body.nfx-premium .items-line__body,' +
                ' body.nfx-premium .items-cards,' +
                ' body.nfx-premium .scroll--horizontal,' +
                ' body.nfx-premium .scroll__content,' +
                ' body.nfx-premium .scroll__body { overflow: visible !important; }');

            css.push('body.nfx-premium .items-line { padding-top: 1.4em; padding-bottom: 2.6em; }');

            css.push('body.nfx-premium .card {' +
                ' transform-origin: center center;' +
                ' -webkit-transition: -webkit-transform 0.3s ease;' +
                ' transition: transform 0.3s ease; }');

            // рідне підстрибування Lampa конфліктує з масштабом
            css.push('body.nfx-premium .card.focus .card__view,' +
                ' body.nfx-premium .card.hover .card__view,' +
                ' body.nfx-premium .card.animate-trigger-enter .card__view {' +
                ' animation: none !important; -webkit-animation: none !important; }');

            css.push('body.nfx-premium .card.focus, body.nfx-premium .card.hover {' +
                ' z-index: 100; transform: scale3d(' + SCALE + ',' + SCALE + ',1); }');
            css.push('body.nfx-premium .card.focus ~ .card,' +
                ' body.nfx-premium .card.hover ~ .card { transform: translate3d(18%,0,0); }');

            css.push('body.nfx-premium .card[data-nfx-edge="first"].focus,' +
                ' body.nfx-premium .card[data-nfx-edge="first"].hover { transform-origin: left center; }');
            css.push('body.nfx-premium .card[data-nfx-edge="last"].focus,' +
                ' body.nfx-premium .card[data-nfx-edge="last"].hover { transform-origin: right center; }');

            css.push('body.nfx-premium .card__view {' +
                ' border-radius: ' + radius + ';' +
                ' box-shadow: 0 0 0 0.12em transparent;' +
                ' -webkit-transition: box-shadow 0.3s ease; transition: box-shadow 0.3s ease; }');
            css.push('body.nfx-premium .card__img { border-radius: ' + radius + '; }');
            css.push('body.nfx-premium .card.focus .card__view,' +
                ' body.nfx-premium .card.hover .card__view {' +
                ' box-shadow: 0 0 0 0.12em ' + ACCENT + ', 0 0 1.2em rgba(229,9,20,0.5), 0 0.6em 1.8em rgba(0,0,0,0.6); }');

            css.push('body.nfx-premium .card__quality { position: absolute !important;' +
                ' left: 0.4em !important; bottom: 0.4em !important; top: auto !important; right: auto !important;' +
                ' z-index: 5; padding: 0.15em 0.5em; border-radius: 0.25em;' +
                ' font-size: 0.8em; font-weight: 700; text-transform: uppercase;' +
                ' color: #fff; background: rgba(46,204,113,0.9) !important; }');

            // у ряду-білборді масштаб не потрібен — там своя механіка 16:9
            css.push('body.nfx-premium .items-line--nfx .card.focus,' +
                ' body.nfx-premium .items-line--nfx .card.hover,' +
                ' body.nfx-premium .items-line--nfx .card.focus ~ .card,' +
                ' body.nfx-premium .items-line--nfx .card.hover ~ .card {' +
                ' transform: none !important; z-index: 1 !important; }');
            css.push('body.nfx-premium .items-line--nfx .card.nfx-open { z-index: 2 !important; }');
        }

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

        /* ── малі екрани ── */
        css.push('@media screen and (max-width: 767px) {' +
            ' .items-line--nfx .card.nfx-open { width: 22em !important; }' +
            ' .nfx-info { min-height: 5.8em; padding: 0 1em; }' +
            ' .nfx-info__layer { left: 1em; right: 1em; }' +
            ' .nfx-hero__logo-img { max-height: 3.5em; }' +
            ' .nfx-nav__tab { font-size: 0.95em; padding: 0.35em 0.8em; } }');

        var style = document.createElement('style');
        style.id = CSS_ID;
        style.textContent = css.join('\n');
        document.head.appendChild(style);
    }

    // =================================================================
    //  7. Застосування налаштувань (без перезапуску)
    // =================================================================

    /** Тільки ці ключі є налаштуваннями. Кеш (nfxc_*) сюди не потрапляє. */
    var SETTING_KEYS = [
        'nfx_nav', 'nfx_nav_items', 'nfx_bg', 'nfx_card_style', 'nfx_radius',
        'nfx_titles', 'nfx_row', 'nfx_scope', 'nfx_pin', 'nfx_wide',
        'nfx_info', 'nfx_logo', 'nfx_logo_lang', 'nfx_chips'
    ];

    function isSettingKey(name) {
        return SETTING_KEYS.indexOf(name) > -1;
    }

    var applyTimer = null;

    /** SettingsApi.onChange і Storage.change приходять парою — склеюємо в один прохід */
    function applyAll() {
        clearTimeout(applyTimer);
        applyTimer = setTimeout(function () {
            injectCSS();
            CardStyle.sync();
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
            grp_nav: 'Шапка',
            nav: 'Шапка в стилі Netflix',
            nav_items: 'Вкладки в шапці',
            nav_basic: 'Головна / Серіали / Фільми',
            nav_plus: '+ Каталог',
            nav_full: '+ Аніме, Каталог, Обране',
            grp_look: 'Вигляд',
            bg: 'Фон за картками',
            bg_lampa: 'Як зараз (фон Lampa)',
            bg_black: 'Чорний',
            card_style: 'Вигляд картки фільму',
            card_plain: 'Як зараз (простий)',
            card_premium: 'Premium (рамка, підсвітка, якість)',
            radius: 'Заокруглення кутів',
            titles: 'Назви під картками',
            grp_row: 'Ряд-білборд',
            row: 'Увімкнути ряд-білборд',
            scope: 'Де застосовувати',
            scope_main: 'Тільки головна',
            scope_all: 'Усі сторінки з рядами',
            pin: 'Позиція фокуса в ряду',
            pin_left: 'Ліворуч (Netflix)',
            pin_center: 'По центру (як у Lampa)',
            wide: 'Ширина розгорнутої картки',
            info: 'Блок опису під рядом',
            logo: 'Логотип тайтлу (TMDB)',
            logo_lang: 'Мова логотипу',
            chips: 'Бейдж якості на розгорнутій картці'
        },
        ru: {
            title: 'NFX Billboard',
            grp_nav: 'Шапка',
            nav: 'Шапка в стиле Netflix',
            nav_items: 'Вкладки в шапке',
            nav_basic: 'Главная / Сериалы / Фильмы',
            nav_plus: '+ Каталог',
            nav_full: '+ Аниме, Каталог, Избранное',
            grp_look: 'Внешний вид',
            bg: 'Фон за карточками',
            bg_lampa: 'Как сейчас (фон Lampa)',
            bg_black: 'Чёрный',
            card_style: 'Вид карточки фильма',
            card_plain: 'Как сейчас (простой)',
            card_premium: 'Premium (рамка, подсветка, качество)',
            radius: 'Скругление углов',
            titles: 'Названия под карточками',
            grp_row: 'Ряд-билборд',
            row: 'Включить ряд-билборд',
            scope: 'Где применять',
            scope_main: 'Только главная',
            scope_all: 'Все страницы с рядами',
            pin: 'Позиция фокуса в ряду',
            pin_left: 'Слева (Netflix)',
            pin_center: 'По центру (как в Lampa)',
            wide: 'Ширина развёрнутой карточки',
            info: 'Блок описания под рядом',
            logo: 'Логотип тайтла (TMDB)',
            logo_lang: 'Язык логотипа',
            chips: 'Бейдж качества на развёрнутой карточке'
        },
        en: {
            title: 'NFX Billboard',
            grp_nav: 'Header',
            nav: 'Netflix-style header',
            nav_items: 'Header tabs',
            nav_basic: 'Home / Series / Movies',
            nav_plus: '+ Catalog',
            nav_full: '+ Anime, Catalog, Favorites',
            grp_look: 'Appearance',
            bg: 'Background behind cards',
            bg_lampa: 'As is (Lampa background)',
            bg_black: 'Black',
            card_style: 'Movie card look',
            card_plain: 'As is (plain)',
            card_premium: 'Premium (border, glow, quality)',
            radius: 'Corner radius',
            titles: 'Titles under cards',
            grp_row: 'Billboard row',
            row: 'Enable billboard row',
            scope: 'Where to apply',
            scope_main: 'Main page only',
            scope_all: 'All pages with rows',
            pin: 'Focus position in row',
            pin_left: 'Left (Netflix)',
            pin_center: 'Center (Lampa default)',
            wide: 'Expanded card width',
            info: 'Description block under row',
            logo: 'Title logo (TMDB)',
            logo_lang: 'Logo language',
            chips: 'Quality badge on expanded card'
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
            // ── шапка ──
            { name: 'nfx_nav', type: 'trigger', def: true, title: t('nav') },
            { name: 'nfx_nav_items', type: 'select', def: 'basic', title: t('nav_items'),
              values: { basic: t('nav_basic'), plus: t('nav_plus'), full: t('nav_full') } },

            // ── вигляд ──
            { name: 'nfx_bg', type: 'select', def: 'lampa', title: t('bg'),
              values: { lampa: t('bg_lampa'), black: t('bg_black') } },
            { name: 'nfx_card_style', type: 'select', def: 'plain', title: t('card_style'),
              values: { plain: t('card_plain'), premium: t('card_premium') } },
            { name: 'nfx_radius', type: 'select', def: '0.4em', title: t('radius'),
              values: { '0em': '0', '0.4em': '0.4em', '0.8em': '0.8em', '1em': '1em' } },
            { name: 'nfx_titles', type: 'trigger', def: false, title: t('titles') },

            // ── ряд ──
            { name: 'nfx_row', type: 'trigger', def: true, title: t('row') },
            { name: 'nfx_scope', type: 'select', def: 'main', title: t('scope'),
              values: { main: t('scope_main'), all: t('scope_all') } },
            { name: 'nfx_pin', type: 'select', def: 'left', title: t('pin'),
              values: { left: t('pin_left'), center: t('pin_center') } },
            { name: 'nfx_wide', type: 'select', def: '34em', title: t('wide'),
              values: { '28em': '2.2x', '31em': '2.4x', '34em': '2.7x (16:9)', '38em': '3.0x' } },
            { name: 'nfx_info', type: 'trigger', def: true, title: t('info') },
            { name: 'nfx_logo', type: 'trigger', def: true, title: t('logo') },
            { name: 'nfx_logo_lang', type: 'select', def: 'auto', title: t('logo_lang'),
              values: { auto: 'Auto', uk: 'Українська', ru: 'Русский', en: 'English' } },
            { name: 'nfx_chips', type: 'trigger', def: true, title: t('chips') }
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
        CardStyle.sync();
        Billboard.init();
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
