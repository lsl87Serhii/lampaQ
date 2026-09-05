(function () {
    'use strict';

    var PLUGIN_KEY = 'nfx_tv_v9';
    var isExoticOS = /Vidaa|Web0S|Tizen|SmartTV|Metrological|NetCast/i.test(navigator.userAgent);

    // ─────────────────────────────────────────────────────────────────
    // 1. НАЛАШТУВАННЯ ТА МОВНИЙ СЛОВНИК (i18n)
    // ─────────────────────────────────────────────────────────────────

    function initSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        var lang = Lampa.Storage.get('language', 'uk');
        if (lang === 'ua') lang = 'uk';

        var i18n = {
            'uk': {
                'title': 'Netflix TV Layout',
                'enable': 'Увімкнути інтерфейс Netflix TV',
                'card_width': 'Ширина активної картки (16:9)',
                'desc_lines': 'Кількість рядків опису',
                'on': 'Увімкнено',
                'off': 'Вимкнено'
            },
            'en': {
                'title': 'Netflix TV Layout',
                'enable': 'Enable Netflix TV UI',
                'card_width': 'Active Card Width (16:9)',
                'desc_lines': 'Description Lines',
                'on': 'Enabled',
                'off': 'Disabled'
            }
        };

        function t(key) {
            var dict = i18n[lang] || i18n['uk'];
            return dict[key] || key;
        }

        // Реєстрація власної секції в налаштуваннях Lampa
        Lampa.SettingsApi.addComponent({
            component: 'nfx_tv_settings',
            name: t('title'),
            icon: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: 'nfx_tv_settings',
            param: {
                name: 'nfx_tv_enabled',
                type: 'select',
                values: { 'true': t('on'), 'false': t('off') },
                default: 'true'
            },
            field: { name: t('enable') },
            onChange: function () { injectCSS(); }
        });

        Lampa.SettingsApi.addParam({
            component: 'nfx_tv_settings',
            param: {
                name: 'nfx_tv_card_width',
                type: 'select',
                values: { '380px': '380px', '420px': '420px (Стандарт)', '460px': '460px' },
                default: '420px'
            },
            field: { name: t('card_width') },
            onChange: function () { injectCSS(); }
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // 2. ДИНАМІЧНІ СТИЛІ (CSS)
    // ─────────────────────────────────────────────────────────────────

    function injectCSS() {
        var old = document.getElementById('nfx-tv-layout-style');
        if (old) old.remove();

        var enabled = Lampa.Storage.get('nfx_tv_enabled', 'true');
        if (enabled === 'false' || enabled === false) return;

        var activeWidth = Lampa.Storage.get('nfx_tv_card_width', '420px');

        var css = `
            /* --- ПРИХОВУЄМО ВСІ ЛОГОТИПИ ТА СТАНДАРТНІ ТИТРИ --- */
            .head__logo, .head__title, .head__time, .head__profile, 
            .head__settings, .head__notice, .head__logo-n, .head__logo-netflix {
                display: none !important;
            }

            /* --- ЦЕНТРОВАНА ШАПКА БЕЗ ЛОГОТИПІВ --- */
            .head {
                background: linear-gradient(180deg, rgba(15,15,15,0.98) 0%, rgba(15,15,15,0) 100%) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                position: fixed !important;
                top: 0; left: 0; right: 0;
                z-index: 2000 !important;
                height: 70px !important;
                padding: 0 50px !important;
            }

            .nfx-tv-nav {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 16px;
            }

            .nfx-nav-item {
                color: #a3a3a3;
                font-size: 16px;
                padding: 8px 20px;
                border-radius: 24px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .nfx-nav-item.focus, .nfx-nav-item:focus {
                background-color: #ffffff !important;
                color: #000000 !important;
                font-weight: bold !important;
                transform: scale(1.05);
            }

            .nfx-nav-item.active {
                color: #ffffff;
            }

            /* --- КАРУСЕЛЬ ТА СЛОТ 16:9 ЗЛІВА --- */
            .scroll__content, .items__layer {
                overflow: hidden !important;
                padding-left: 50px !important;
            }

            .items__body {
                display: flex !important;
                align-items: flex-start !important;
                gap: 18px !important;
                transition: transform 0.35s cubic-bezier(0.25, 1, 0.5, 1) !important;
                will-change: transform;
            }

            /* Неактивні вертикальні картки */
            .card {
                width: 155px !important;
                height: 232px !important;
                flex-shrink: 0 !important;
                border-radius: 8px !important;
                transition: width 0.35s ease, height 0.35s ease, opacity 0.25s ease !important;
                overflow: hidden !important;
                border: none !important;
            }

            .card .card__view {
                width: 100% !important;
                height: 100% !important;
                border-radius: 8px !important;
            }

            .card .card__img {
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
            }

            /* ФІКСОВАНА АКТИВНА КАРТКА 16:9 У ЛІВОМУ СЛОТІ */
            .card.focus {
                width: ${activeWidth} !important;
                height: 232px !important;
                box-shadow: 0 14px 35px rgba(0,0,0,0.95), 0 0 0 3px #FFFFFF !important;
                z-index: 100 !important;
            }

            /* Приховуємо картки за межами 3 вертикальних праворуч */
            .card.nfx-out-of-bounds {
                opacity: 0 !important;
                pointer-events: none !important;
            }

            .card:not(.focus) .card__title, 
            .card:not(.focus) .card__age,
            .card:not(.focus) .card__quality {
                display: none !important;
            }

            /* --- ДЕТАЛІ ПІД КАРОУСЕЛЛЮ --- */
            .nfx-details-container {
                padding: 18px 50px 25px 50px;
                color: #ffffff;
                max-width: 900px;
                animation: nfxSlideUp 0.2s ease-out;
            }

            .nfx-details-container .nfx-title {
                font-size: 26px;
                font-weight: 800;
                margin-bottom: 6px;
            }

            .nfx-details-container .nfx-meta {
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 15px;
                color: #a3a3a3;
                margin-bottom: 8px;
            }

            .nfx-details-container .nfx-match {
                color: #46d369;
                font-weight: bold;
            }

            .nfx-details-container .nfx-overview {
                font-size: 14px;
                line-height: 1.45;
                color: #cccccc;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                overflow: hidden;
                margin-bottom: 10px;
            }

            .nfx-details-container .nfx-badge {
                display: inline-flex;
                align-items: center;
                background: rgba(255, 255, 255, 0.15);
                padding: 5px 12px;
                border-radius: 4px;
                font-size: 13px;
                color: #ffffff;
            }

            @keyframes nfxSlideUp {
                from { opacity: 0; transform: translateY(4px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;

        var style = document.createElement('style');
        style.id = 'nfx-tv-layout-style';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ─────────────────────────────────────────────────────────────────
    // 3. АКТИВНА ШАПКА ДЛЯ ПУЛЬТА SMART TV
    // ─────────────────────────────────────────────────────────────────

    function setupHeaderNav() {
        var head = document.querySelector('.head');
        if (!head || head.querySelector('.nfx-tv-nav')) return;

        var nav = document.createElement('div');
        nav.className = 'nfx-tv-nav';
        nav.innerHTML = `
            <div class="nfx-nav-item focusable" data-action="search">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                Пошук
            </div>
            <div class="nfx-nav-item focusable active" data-action="home">Головна</div>
            <div class="nfx-nav-item focusable" data-action="tv">Серіали</div>
            <div class="nfx-nav-item focusable" data-action="movie">Фільми</div>
            <div class="nfx-nav-item focusable" data-action="settings">Налаштування</div>
        `;

        head.appendChild(nav);

        nav.addEventListener('click', function (e) {
            var item = e.target.closest('.nfx-nav-item');
            if (!item) return;

            var action = item.getAttribute('data-action');
            if (action === 'search') Lampa.Search.open();
            if (action === 'home') Lampa.Activity.push({ title: 'Головна', component: 'main' });
            if (action === 'tv') Lampa.Activity.push({ title: 'Серіали', component: 'tv' });
            if (action === 'movie') Lampa.Activity.push({ title: 'Фільми', component: 'movie' });
            if (action === 'settings') Lampa.Activity.push({ title: 'Налаштування', component: 'settings' });
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // 4. МЕХАНІКА ФІКСОВАНОГО СЛОТА ЗЛІВА ТА КАРУСЕЛІ
    // ─────────────────────────────────────────────────────────────────

    function initTVEngine() {
        Lampa.Listener.follow('card', function (e) {
            var enabled = Lampa.Storage.get('nfx_tv_enabled', 'true');
            if (enabled === 'false' || enabled === false) return;

            if (e.type === 'focus') {
                var card = e.target;
                var data = e.data || {};

                // 1. Фіксуємо активну рамку зліва, підсуваючи карусель
                shiftRowKeepLeft(card);

                // 2. Підставляємо горизонтальний Backdrop (16:9)
                if (data.backdrop_path || data.background) {
                    var img = card.querySelector('.card__img');
                    if (img) {
                        if (!card.dataset.posterSrc) card.dataset.posterSrc = img.src;
                        var backdropUrl = Lampa.TMDB ? Lampa.TMDB.image('backdrop', data.backdrop_path, 'w780') : (data.background || img.src);
                        img.src = backdropUrl;
                    }
                }

                // 3. Відображаємо опис
                renderDetailsPanel(card, data);
            }

            if (e.type === 'blur') {
                var card = e.target;
                if (card && card.dataset.posterSrc) {
                    var img = card.querySelector('.card__img');
                    if (img) img.src = card.dataset.posterSrc;
                    delete card.dataset.posterSrc;
                }
            }
        });
    }

    function shiftRowKeepLeft(activeCard) {
        var row = activeCard.closest('.items__body') || activeCard.closest('.category-full__body');
        if (!row) return;

        var cards = Array.from(row.children);
        var activeIndex = cards.indexOf(activeCard);

        if (activeIndex !== -1) {
            // Крок зсуву: 155px (ширина малого постеру) + 18px gap = 173px
            var shiftX = activeIndex * 173;
            row.style.transform = 'translateX(-' + shiftX + 'px)';

            // Залишаємо видимою тільки 1 активну картку 16:9 + 3 вертикальні праворуч
            cards.forEach(function (c, idx) {
                if (idx < activeIndex || idx > activeIndex + 3) {
                    c.classList.add('nfx-out-of-bounds');
                } else {
                    c.classList.remove('nfx-out-of-bounds');
                }
            });
        }
    }

    function renderDetailsPanel(card, data) {
        var row = card.closest('.items__body') || card.closest('.category-full__body');
        if (!row) return;

        var parent = row.parentNode;
        var panel = parent.querySelector('.nfx-details-container');
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'nfx-details-container';
            parent.insertBefore(panel, row.nextSibling);
        }

        var title = data.title || data.name || '';
        var type = data.name ? 'Серіал' : 'Фільм';
        var year = (data.release_date || data.first_air_date || '').substring(0, 4) || '2026';
        var rating = data.vote_average ? Math.round(data.vote_average * 10) + '% збіг' : '98% збіг';
        var overview = data.overview || 'Опис доступний при перегляді деталей.';

        panel.innerHTML = `
            <div class="nfx-title">${title}</div>
            <div class="nfx-meta">
                <span class="nfx-match">${rating}</span>
                <span>${year}</span>
                <span>${type}</span>
                <span>16+</span>
            </div>
            <div class="nfx-overview">${overview}</div>
            <div class="nfx-badge">👍 Гадаємо, вам це дуже сподобається</div>
        `;
    }

    // ─────────────────────────────────────────────────────────────────
    // 5. БУТСТРАП ТА СТЕЖЕННЯ ЗА ЗМІНАМИ STORAGE
    // ─────────────────────────────────────────────────────────────────

    function bootstrap() {
        if (window.__nfx_tv_layout_injected) return;
        window.__nfx_tv_layout_injected = true;

        initSettings();
        injectCSS();
        setupHeaderNav();
        initTVEngine();

        // Автоматичне перемальовування CSS при зміні налаштувань у Storage
        if (window.Lampa && Lampa.Storage && Lampa.Storage.listener) {
            Lampa.Storage.listener.follow('change', function (e) {
                if (e.name && e.name.indexOf('nfx_tv_') === 0) {
                    injectCSS();
                }
            });
        }

        console.log('[NFX TV Engine] Ready & Running');
    }

    if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') bootstrap();
        });
        setTimeout(bootstrap, 500);
    } else {
        var poll = setInterval(function () {
            if (typeof Lampa !== 'undefined' && Lampa.Listener) {
                clearInterval(poll);
                Lampa.Listener.follow('app', function (e) {
                    if (e.type === 'ready') bootstrap();
                });
                setTimeout(bootstrap, 500);
            }
        }, 200);
    }
})();