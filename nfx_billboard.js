(function () {
    'use strict';

    /* ================================================================
     *  NFX Billboard  v1.0
     *  Перший ряд у стилі Netflix TV:
     *    - картка у фокусі розгортається з постера (2:3) у backdrop (16:9)
     *    - фокус прибитий до лівого краю ряду (scroll.update(el, false))
     *    - лого тайтлу з TMDB, чипи, блок мета + опису під рядом
     *    - крос-фейд мета/опису при зміні фокуса
     *
     *  Ціль: Lampa, стандартний інтерфейс. Перевірено по вихідниках
     *  yumata/lampa-source (interaction/items/line, interaction/card).
     * ================================================================ */

    var PLUGIN_ID = 'nfx_billboard';
    var VERSION = '1.0';

    // ─────────────────────────────────────────────────────────────────
    //  Утиліти
    // ─────────────────────────────────────────────────────────────────

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

    /** Дістати дані картки з DOM-елемента (нові й старі збірки Lampa) */
    function cardData(el) {
        if (!el) return null;
        if (el.card_data) return el.card_data;
        try {
            var d = $(el).data('card');
            if (d) return d;
        } catch (e) { /* no jquery data */ }
        return null;
    }

    function el(tag, cls) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        return n;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Жанри TMDB (кеш у Storage, один запит на мову/тип)
    // ─────────────────────────────────────────────────────────────────

    var Genres = {
        map: {},

        load: function (type) {
            var l = lang();
            var key = 'nfx_bb_genres_' + type + '_' + l;
            var cached = S(key, null);

            if (cached && typeof cached === 'object') {
                this.map[type] = cached;
                return;
            }

            var self = this;
            var url;

            try {
                url = Lampa.TMDB.api('genre/' + type + '/list?api_key=' + Lampa.TMDB.key() + '&language=' + l);
            } catch (e) { return; }

            $.get(url, function (data) {
                var m = {};
                if (data && data.genres) {
                    for (var i = 0; i < data.genres.length; i++) m[data.genres[i].id] = data.genres[i].name;
                }
                self.map[type] = m;
                try { Lampa.Storage.set(key, m); } catch (e) { /* ignore */ }
            });
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

    // ─────────────────────────────────────────────────────────────────
    //  Логотипи тайтлів (TMDB /images)
    // ─────────────────────────────────────────────────────────────────

    var LogoEngine = {
        prefix: 'nfx_bb_logo_',

        key: function (type, id, l) {
            return this.prefix + type + '_' + id + '_' + l;
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

            var sorted = logos.slice().sort(function (a, b) {
                var aS = (a.file_path || '').toLowerCase().indexOf('.svg') > -1;
                var bS = (b.file_path || '').toLowerCase().indexOf('.svg') > -1;
                return aS === bS ? 0 : (aS ? 1 : -1);
            });

            var i;
            for (i = 0; i < sorted.length; i++) {
                if (sorted[i].iso_639_1 === target && sorted[i].file_path) return sorted[i].file_path;
            }
            if (target === 'uk') {
                for (i = 0; i < sorted.length; i++) {
                    if (sorted[i].iso_639_1 === 'ru' && sorted[i].file_path) return sorted[i].file_path;
                }
            }
            for (i = 0; i < sorted.length; i++) {
                if (sorted[i].iso_639_1 === 'en' && sorted[i].file_path) return sorted[i].file_path;
            }
            return sorted[0] && sorted[0].file_path ? sorted[0].file_path : null;
        },

        pickLang: function () {
            var manual = S('nfx_bb_logo_lang', 'auto');
            if (manual && manual !== 'auto') return manual;
            return lang();
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

    // ─────────────────────────────────────────────────────────────────
    //  Мета-рядок
    // ─────────────────────────────────────────────────────────────────

    function metaLine(data) {
        var isTv = !!data.name;
        var type = isTv ? 'tv' : 'movie';
        var parts = [];

        parts.push(Lampa.Lang.translate(isTv ? 'title_tv' : 'title_movie') || (isTv ? 'Серіал' : 'Фільм'));

        var g = Genres.names(type, data.genre_ids, 2);
        for (var i = 0; i < g.length; i++) parts.push(g[i]);

        var date = data.release_date || data.first_air_date || '';
        if (date) parts.push(date.slice(0, 4));

        if (data.number_of_seasons) parts.push(data.number_of_seasons + ' сез.');

        if (data.vote_average) parts.push('TMDB ' + parseFloat(data.vote_average).toFixed(1));

        return parts.join('  ·  ');
    }

    // ─────────────────────────────────────────────────────────────────
    //  Розгорнута картка (hero)
    // ─────────────────────────────────────────────────────────────────

    function buildHero(cardEl, data) {
        var view = cardEl.querySelector('.card__view');
        if (!view) return;

        var old = view.querySelector('.nfx-hero');
        if (old) old.parentNode.removeChild(old);

        var hero = el('div', 'nfx-hero');

        var img = el('img', 'nfx-hero__img');
        img.onload = function () { img.classList.add('nfx-hero__img--in'); };
        img.src = tmdbImage(data.backdrop_path, 'w780') || tmdbImage(data.poster_path, 'w500');
        hero.appendChild(img);

        var shade = el('div', 'nfx-hero__shade');
        hero.appendChild(shade);

        var logoBox = el('div', 'nfx-hero__logo');
        var fallback = el('div', 'nfx-hero__name');
        fallback.textContent = data.title || data.name || '';
        logoBox.appendChild(fallback);
        hero.appendChild(logoBox);

        if (isOn('nfx_bb_chips', true)) {
            var chips = el('div', 'nfx-hero__chips');
            var q = cardEl.querySelector('.card__quality');
            if (q && q.textContent.trim()) {
                var c1 = el('div', 'nfx-chip');
                c1.textContent = q.textContent.trim();
                chips.appendChild(c1);
            }
            if (data.vote_average) {
                var c2 = el('div', 'nfx-chip nfx-chip--rate');
                c2.textContent = parseFloat(data.vote_average).toFixed(1);
                chips.appendChild(c2);
            }
            if (chips.childNodes.length) hero.appendChild(chips);
        }

        view.appendChild(hero);

        if (isOn('nfx_bb_logo', true)) {
            LogoEngine.resolve(data, function (url) {
                if (!url || !hero.parentNode) return;
                var li = el('img', 'nfx-hero__logo-img');
                li.onload = function () {
                    if (!hero.parentNode) return;
                    fallback.style.opacity = '0';
                    li.classList.add('nfx-hero__logo-img--in');
                };
                li.src = url;
                logoBox.appendChild(li);
            });
        }
    }

    function clearHero(cardEl) {
        if (!cardEl) return;
        var h = cardEl.querySelector('.nfx-hero');
        if (h && h.parentNode) h.parentNode.removeChild(h);
    }

    // ─────────────────────────────────────────────────────────────────
    //  Блок мета + опису під рядом (два шари для крос-фейду)
    // ─────────────────────────────────────────────────────────────────

    function buildInfo(lineEl) {
        var box = el('div', 'nfx-info');
        var a = el('div', 'nfx-info__layer nfx-info__layer--active');
        var b = el('div', 'nfx-info__layer');

        [a, b].forEach(function (layer) {
            layer.appendChild(el('div', 'nfx-info__meta'));
            layer.appendChild(el('div', 'nfx-info__text'));
        });

        box.appendChild(a);
        box.appendChild(b);

        var body = lineEl.querySelector('.items-line__body');
        if (body && body.parentNode) body.parentNode.insertBefore(box, body.nextSibling);
        else lineEl.appendChild(box);

        return { box: box, layers: [a, b], index: 0, first: true };
    }

    function renderInfo(info, data) {
        if (!info) return;

        // перший показ — пишемо в уже активний шар, без фейду з порожнього
        if (info.first) {
            info.first = false;
            var l0 = info.layers[info.index];
            l0.querySelector('.nfx-info__meta').textContent = metaLine(data);
            l0.querySelector('.nfx-info__text').textContent = data.overview || '';
            return;
        }

        var next = info.layers[(info.index + 1) % 2];
        var curr = info.layers[info.index];

        next.querySelector('.nfx-info__meta').textContent = metaLine(data);
        next.querySelector('.nfx-info__text').textContent = data.overview || '';

        curr.classList.remove('nfx-info__layer--active');
        next.classList.add('nfx-info__layer--active');

        info.index = (info.index + 1) % 2;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Підключення до ряду
    // ─────────────────────────────────────────────────────────────────

    function attach(line) {
        if (line.__nfx_bound) return;
        line.__nfx_bound = true;

        var lineEl = line.render(true);
        lineEl.classList.add('items-line--nfx');

        var ctx = {
            line: line,
            info: isOn('nfx_bb_info', true) ? buildInfo(lineEl) : null,
            current: null
        };

        Genres.load('movie');
        Genres.load('tv');

        function open(item) {
            if (!item) return;

            var cardEl = item.render(true);
            if (!cardEl || ctx.current === cardEl) return;

            if (ctx.current) {
                ctx.current.classList.remove('nfx-open');
                clearHero(ctx.current);
            }

            ctx.current = cardEl;
            cardEl.classList.add('nfx-open');

            var data = item.data || cardData(cardEl) || {};

            buildHero(cardEl, data);
            renderInfo(ctx.info, data);

            // ширина змінюється миттєво → геометрія вже фінальна
            if (S('nfx_bb_pin', 'left') === 'left' && line.scroll) {
                line.scroll.update(cardEl, false);
            }
        }

        line.use({
            onActive: function (item) { open(item); },
            onDestroy: function () { ctx.current = null; }
        });

        // початковий стан: розгорнути першу картку
        var tries = 0;
        var timer = setInterval(function () {
            if (ctx.current) return clearInterval(timer);
            if (line.items && line.items.length) {
                open(line.items[0]);
                clearInterval(timer);
            }
            if (++tries > 40) clearInterval(timer);
        }, 100);
    }

    function initLineHook() {
        if (window.__nfx_bb_line) return;
        window.__nfx_bb_line = true;

        Lampa.Listener.follow('line', function (e) {
            if (e.type !== 'create') return;
            if (!isOn('nfx_bb_enable', true)) return;

            var line = e.line;

            setTimeout(function () {
                try {
                    var lineEl = line.render(true);
                    if (!lineEl || !lineEl.parentNode) return;

                    // тільки перший ряд у своєму контейнері
                    var siblings = lineEl.parentNode.querySelectorAll('.items-line');
                    if (!siblings.length || siblings[0] !== lineEl) return;

                    if (S('nfx_bb_scope', 'main') === 'main') {
                        var act = Lampa.Activity.active();
                        if (!act || act.component !== 'main') return;
                    }

                    attach(line);
                } catch (err) {
                    console.log('[NFX Billboard] attach error', err);
                }
            }, 0);
        });
    }

    // ─────────────────────────────────────────────────────────────────
    //  CSS
    // ─────────────────────────────────────────────────────────────────

    function injectCSS() {
        var old = document.getElementById('nfx-billboard-css');
        if (old) old.parentNode.removeChild(old);

        var wide = S('nfx_bb_wide', '34em');
        var radius = S('nfx_bb_radius', '0.4em');
        var titles = isOn('nfx_bb_titles', false) ? 'block' : 'none';

        var css = '' +
        '.items-line--nfx .card__title,' +
        '.items-line--nfx .card__age { display: ' + titles + ' !important; }' +

        '.items-line--nfx .card {' +
        '  transition: width 0s;' +
        '}' +

        '.items-line--nfx .card__view {' +
        '  margin-bottom: 0.6em;' +
        '  overflow: hidden;' +
        '  border-radius: ' + radius + ';' +
        '}' +

        '.items-line--nfx .card__img {' +
        '  border-radius: ' + radius + ';' +
        '  transition: opacity 0.25s ease;' +
        '}' +

        /* ── розгорнута картка ── */
        '.items-line--nfx .card.nfx-open {' +
        '  width: ' + wide + ' !important;' +
        '}' +

        '.items-line--nfx .card.nfx-open .card__view {' +
        '  padding-bottom: 56.25% !important;' +
        '}' +

        '.items-line--nfx .card.nfx-open .card__img { opacity: 0; }' +

        '.items-line--nfx .card.nfx-open.focus .card__view {' +
        '  box-shadow: inset 0 0 0 0.18em rgba(255,255,255,0.9);' +
        '}' +

        /* ── hero ── */
        '.nfx-hero {' +
        '  position: absolute; left: 0; top: 0; right: 0; bottom: 0;' +
        '  border-radius: ' + radius + '; overflow: hidden;' +
        '}' +

        '.nfx-hero__img {' +
        '  position: absolute; left: 0; top: 0; width: 100%; height: 100%;' +
        '  object-fit: cover; opacity: 0;' +
        '  -webkit-transition: opacity 0.35s ease; transition: opacity 0.35s ease;' +
        '}' +
        '.nfx-hero__img--in { opacity: 1; }' +

        '.nfx-hero__shade {' +
        '  position: absolute; left: 0; right: 0; bottom: 0; height: 55%;' +
        '  background: -webkit-linear-gradient(top, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%);' +
        '  background: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%);' +
        '}' +

        '.nfx-hero__logo {' +
        '  position: absolute; left: 1.2em; bottom: 1.1em;' +
        '  max-width: 55%; max-height: 40%;' +
        '  display: flex; align-items: flex-end;' +
        '}' +

        '.nfx-hero__name {' +
        '  font-size: 1.5em; font-weight: 800; line-height: 1.1; color: #fff;' +
        '  text-shadow: 0 2px 10px rgba(0,0,0,0.8);' +
        '  -webkit-transition: opacity 0.3s ease; transition: opacity 0.3s ease;' +
        '}' +

        '.nfx-hero__logo-img {' +
        '  position: absolute; left: 0; bottom: 0;' +
        '  max-width: 100%; max-height: 5.5em; width: auto; height: auto;' +
        '  object-fit: contain; object-position: left bottom;' +
        '  opacity: 0;' +
        '  -webkit-transition: opacity 0.4s ease; transition: opacity 0.4s ease;' +
        '  filter: drop-shadow(0 3px 14px rgba(0,0,0,0.7));' +
        '}' +
        '.nfx-hero__logo-img--in { opacity: 1; }' +

        '.nfx-hero__chips {' +
        '  position: absolute; right: 1em; bottom: 1.1em;' +
        '  display: flex; align-items: center;' +
        '}' +

        '.nfx-chip {' +
        '  margin-left: 0.5em; padding: 0.25em 0.7em;' +
        '  border-radius: 0.3em; font-size: 0.85em; font-weight: 700;' +
        '  color: #fff; background: rgba(0,0,0,0.55);' +
        '  border: 1px solid rgba(255,255,255,0.25);' +
        '}' +
        '.nfx-chip--rate { background: rgba(46,204,113,0.85); border-color: transparent; }' +

        /* ── блок під рядом ── */
        '.nfx-info {' +
        '  position: relative; margin: 0.9em 0 0.2em 0;' +
        '  padding: 0 1.5em; min-height: 7.2em;' +
        '}' +

        '.nfx-info__layer {' +
        '  position: absolute; left: 1.5em; right: 1.5em; top: 0;' +
        '  opacity: 0; pointer-events: none;' +
        '  -webkit-transition: opacity 0.35s ease; transition: opacity 0.35s ease;' +
        '}' +
        '.nfx-info__layer--active { opacity: 1; }' +

        '.nfx-info__meta {' +
        '  font-size: 1.05em; font-weight: 600; line-height: 1.3;' +
        '  color: rgba(255,255,255,0.85); margin-bottom: 0.35em;' +
        '}' +

        '.nfx-info__text {' +
        '  font-size: 1.05em; line-height: 1.4; max-width: 46em;' +
        '  color: rgba(255,255,255,0.7);' +
        '  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;' +
        '  overflow: hidden;' +
        '}' +

        '@media screen and (max-width: 767px) {' +
        '  .items-line--nfx .card.nfx-open { width: 22em !important; }' +
        '  .nfx-info { min-height: 6em; padding: 0 1em; }' +
        '  .nfx-info__layer { left: 1em; right: 1em; }' +
        '  .nfx-hero__logo-img { max-height: 3.5em; }' +
        '}';

        var style = document.createElement('style');
        style.id = 'nfx-billboard-css';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ─────────────────────────────────────────────────────────────────
    //  Налаштування
    // ─────────────────────────────────────────────────────────────────

    function initSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        var l = lang();

        var i18n = {
            uk: {
                title: 'NFX Billboard',
                enable: 'Увімкнути',
                scope: 'Де застосовувати',
                scope_main: 'Тільки головна',
                scope_all: 'Усі сторінки з рядами',
                wide: 'Ширина розгорнутої картки',
                pin: 'Позиція фокуса в ряду',
                pin_left: 'Прибити до лівого краю (Netflix)',
                pin_center: 'По центру (як у Lampa)',
                info: 'Блок опису під рядом',
                logo: 'Логотип тайтлу (TMDB)',
                logo_lang: 'Мова логотипу',
                chips: 'Бейджі на картці',
                titles: 'Назви під картками',
                radius: 'Заокруглення кутів',
                on: 'Увімк.',
                off: 'Вимк.',
                auto: 'Авто'
            },
            ru: {
                title: 'NFX Billboard',
                enable: 'Включить',
                scope: 'Где применять',
                scope_main: 'Только главная',
                scope_all: 'Все страницы с рядами',
                wide: 'Ширина развёрнутой карточки',
                pin: 'Позиция фокуса в ряду',
                pin_left: 'Прижать к левому краю (Netflix)',
                pin_center: 'По центру (как в Lampa)',
                info: 'Блок описания под рядом',
                logo: 'Логотип тайтла (TMDB)',
                logo_lang: 'Язык логотипа',
                chips: 'Бейджи на карточке',
                titles: 'Названия под карточками',
                radius: 'Скругление углов',
                on: 'Вкл.',
                off: 'Выкл.',
                auto: 'Авто'
            },
            en: {
                title: 'NFX Billboard',
                enable: 'Enable',
                scope: 'Where to apply',
                scope_main: 'Main page only',
                scope_all: 'All pages with rows',
                wide: 'Expanded card width',
                pin: 'Focus position in row',
                pin_left: 'Pin to left edge (Netflix)',
                pin_center: 'Center (Lampa default)',
                info: 'Description block under row',
                logo: 'Title logo (TMDB)',
                logo_lang: 'Logo language',
                chips: 'Card badges',
                titles: 'Titles under cards',
                radius: 'Corner radius',
                on: 'On',
                off: 'Off',
                auto: 'Auto'
            }
        };

        function t(k) {
            var d = i18n[l] || i18n.en;
            return d[k] || i18n.en[k] || k;
        }

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            name: t('title'),
            icon: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="12" height="14" rx="2"></rect><rect x="16" y="8" width="6" height="8" rx="1"></rect></svg>'
        });

        var params = [
            { name: 'nfx_bb_enable', type: 'trigger', def: true, title: t('enable') },
            { name: 'nfx_bb_scope', type: 'select', def: 'main', title: t('scope'),
              values: { 'main': t('scope_main'), 'all': t('scope_all') } },
            { name: 'nfx_bb_pin', type: 'select', def: 'left', title: t('pin'),
              values: { 'left': t('pin_left'), 'center': t('pin_center') } },
            { name: 'nfx_bb_wide', type: 'select', def: '34em', title: t('wide'),
              values: { '28em': '2.2x', '31em': '2.4x', '34em': '2.7x (16:9)', '38em': '3.0x' } },
            { name: 'nfx_bb_radius', type: 'select', def: '0.4em', title: t('radius'),
              values: { '0em': '0', '0.4em': '0.4em', '0.8em': '0.8em', '1em': '1em' } },
            { name: 'nfx_bb_info', type: 'trigger', def: true, title: t('info') },
            { name: 'nfx_bb_logo', type: 'trigger', def: true, title: t('logo') },
            { name: 'nfx_bb_logo_lang', type: 'select', def: 'auto', title: t('logo_lang'),
              values: { 'auto': t('auto'), 'uk': 'Українська', 'ru': 'Русский', 'en': 'English' } },
            { name: 'nfx_bb_chips', type: 'trigger', def: true, title: t('chips') },
            { name: 'nfx_bb_titles', type: 'trigger', def: false, title: t('titles') }
        ];

        params.forEach(function (p) {
            var conf = { name: p.name, type: p.type, default: p.def };
            if (p.values) conf.values = p.values;

            Lampa.SettingsApi.addParam({
                component: PLUGIN_ID,
                param: conf,
                field: { name: p.title },
                onChange: function () { injectCSS(); }
            });
        });
    }

    // ─────────────────────────────────────────────────────────────────
    //  Bootstrap
    // ─────────────────────────────────────────────────────────────────

    function bootstrap() {
        if (window.__nfx_billboard) return;
        window.__nfx_billboard = true;

        initSettings();
        injectCSS();
        initLineHook();

        if (Lampa.Storage && Lampa.Storage.listener) {
            Lampa.Storage.listener.follow('change', function (e) {
                if (e.name && e.name.indexOf('nfx_bb_') === 0) injectCSS();
            });
        }

        console.log('[NFX Billboard] v' + VERSION + ' ready');
    }

    if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') bootstrap();
        });
        setTimeout(bootstrap, 800);
    } else {
        var poll = setInterval(function () {
            if (typeof Lampa !== 'undefined' && Lampa.Listener) {
                clearInterval(poll);
                Lampa.Listener.follow('app', function (e) {
                    if (e.type === 'ready') bootstrap();
                });
                setTimeout(bootstrap, 800);
            }
        }, 200);
    }

})();
