(function () {
    'use strict';

    // 1. Інтеграція в меню Налаштування -> Інтерфейс
    function registerSettings() {
        if (window.Lampa && Lampa.SettingsApi) {
            Lampa.SettingsApi.addParam({
                component: 'interface',
                param: {
                    name: 'netflix_tv_mode',
                    type: 'select',
                    values: {
                        true: 'Увімкнено',
                        false: 'Вимкнено'
                    },
                    default: 'true'
                },
                field: {
                    name: 'Інтерфейс Netflix TV',
                    description: 'Шапка Netflix, фіксована картка 16:9 зліва та опис'
                },
                onChange: function (val) {
                    Lampa.Storage.set('netflix_tv_mode', val);
                    if (window.Lampa && Lampa.Noty) {
                        Lampa.Noty.show('Перезапустіть Lampa для застосування');
                    }
                }
            });
        }
    }

    // 2. Повна стилізація під Netflix
    function injectCSS() {
        if (document.getElementById('lampa-netflix-tv-full-css')) return;

        var style = document.createElement('style');
        style.id = 'lampa-netflix-tv-full-css';
        style.innerHTML = `
            /* Темний фон */
            body, .background, .activity, .scroll {
                background-color: #141414 !important;
            }

            /* --- ПРИХОВУЄМО СТАНДАРТНУ ШАПКУ LAMPA --- */
            .head__title, .head__time, .head__profile, .head__settings, .head__notice, .head__action {
                display: none !important;
            }

            .head {
                background: linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0) 100%) !important;
                display: flex !important;
                align-items: center !important;
                padding: 20px 50px !important;
                position: fixed !important;
                top: 0; left: 0; right: 0;
                z-index: 1000 !important;
                height: 75px !important;
            }

            /* --- НОВА ШАПКА NETFLIX --- */
            .nf-custom-header {
                display: flex;
                align-items: center;
                width: 100%;
            }

            .nf-nav-items {
                display: flex;
                align-items: center;
                gap: 20px;
            }

            .nf-nav-item {
                color: #e5e5e5;
                font-size: 16px;
                padding: 6px 14px;
                border-radius: 20px;
                font-weight: 500;
                cursor: pointer;
            }

            .nf-nav-item.active {
                background-color: rgba(255, 255, 255, 0.2);
                color: #ffffff;
                font-weight: bold;
            }

            .nf-logo-n {
                color: #E50914;
                font-size: 34px;
                font-weight: 900;
                font-family: sans-serif;
                margin-left: auto;
            }

            /* --- КАРУСЕЛЬ ТА КАРТКИ (16:9 ЗЛІВА + 3 ВЕРТИКАЛЬНІ ПРАВОРУЧ) --- */
            .items__body, .category-full__body {
                display: flex !important;
                align-items: flex-start !important;
                padding-left: 50px !important;
                gap: 16px !important;
                overflow: visible !important;
            }

            /* Звичайні неактивні картки (Вертикальні) */
            .card {
                width: 140px !important;
                height: 210px !important;
                flex-shrink: 0 !important;
                border-radius: 6px !important;
                transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1) !important;
                overflow: hidden !important;
                border: none !important;
            }

            .card .card__view {
                width: 100% !important;
                height: 100% !important;
                border-radius: 6px !important;
            }

            .card .card__img {
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
            }

            /* АКТИВНА КАРТКА У ФОКУСІ: Горизонтальна 16:9 */
            .card.focus {
                width: 373px !important; /* Пропорція 16:9 при висоті 210px */
                height: 210px !important;
                box-shadow: 0 10px 30px rgba(0,0,0,0.9), 0 0 0 3px #FFFFFF !important;
                z-index: 100 !important;
            }

            .card:not(.focus) .card__title, .card:not(.focus) .card__age {
                display: none !important;
            }

            /* --- ОПИС ПІД АКТИВНИМ РЯДОМ --- */
            .nf-details-panel {
                padding: 15px 50px 25px 50px;
                color: #ffffff;
                max-width: 900px;
                animation: nfFade 0.2s ease-out;
            }

            .nf-details-panel .nf-title-text {
                font-size: 22px;
                font-weight: bold;
                margin-bottom: 6px;
            }

            .nf-details-panel .nf-meta-line {
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 14px;
                color: #a3a3a3;
                margin-bottom: 8px;
            }

            .nf-details-panel .nf-match {
                color: #46d369;
                font-weight: bold;
            }

            .nf-details-panel .nf-overview-text {
                font-size: 14px;
                line-height: 1.4;
                color: #cccccc;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                overflow: hidden;
                margin-bottom: 10px;
            }

            .nf-details-panel .nf-badge-recommend {
                display: inline-block;
                background: rgba(255, 255, 255, 0.15);
                padding: 5px 12px;
                border-radius: 4px;
                font-size: 12px;
                color: #fff;
            }

            @keyframes nfFade {
                from { opacity: 0; transform: translateY(-4px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    // 3. Логіка заміни елементів
    function initNetflixPlugin() {
        var enabled = Lampa.Storage.get('netflix_tv_mode', 'true');
        if (enabled === 'false' || enabled === false) return;

        setupHeader();

        Lampa.Listener.follow('card', function (e) {
            if (e.type === 'focus') {
                var card = e.target;
                var data = e.data || {};

                // Заміна зображення на 16:9 Backdrop
                if (data.backdrop_path || data.background) {
                    var img = card.querySelector('.card__img');
                    if (img) {
                        if (!card.dataset.posterSrc) card.dataset.posterSrc = img.src;
                        var backdropUrl = Lampa.TMDB ? Lampa.TMDB.image('backdrop', data.backdrop_path, 'w780') : (data.background || img.src);
                        img.src = backdropUrl;
                    }
                }

                renderDetails(card, data);
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

    function setupHeader() {
        var head = document.querySelector('.head');
        if (!head || head.querySelector('.nf-custom-header')) return;

        var headerHTML = document.createElement('div');
        headerHTML.className = 'nf-custom-header';
        headerHTML.innerHTML = `
            <div class="nf-nav-items">
                <div class="nf-nav-item active">Головна</div>
                <div class="nf-nav-item">Серіали</div>
                <div class="nf-nav-item">Фільми</div>
                <div class="nf-nav-item">Мій Netflix</div>
            </div>
            <div class="nf-logo-n">N</div>
        `;
        head.appendChild(headerHTML);
    }

    function renderDetails(card, data) {
        var row = card.closest('.items__body') || card.closest('.category-full__body');
        if (!row) return;

        var panel = row.nextElementSibling;
        if (!panel || !panel.classList.contains('nf-details-panel')) {
            panel = document.createElement('div');
            panel.className = 'nf-details-panel';
            row.parentNode.insertBefore(panel, row.nextSibling);
        }

        var title = data.title || data.name || '';
        var type = data.name ? 'Серіал' : 'Фільм';
        var year = (data.release_date || data.first_air_date || '').substring(0, 4);
        var rating = data.vote_average ? `${Math.round(data.vote_average * 10)}% збіг` : '98% збіг';
        var overview = data.overview || 'Опис доступний при відкритті картки.';

        panel.innerHTML = `
            <div class="nf-title-text">${title}</div>
            <div class="nf-meta-line">
                <span class="nf-match">${rating}</span>
                <span>${year ? year : '2026'}</span>
                <span>${type}</span>
                <span>16+</span>
            </div>
            <div class="nf-overview-text">${overview}</div>
            <div class="nf-badge-recommend">👍 Гадаємо, вам це дуже сподобається</div>
        `;
    }

    function start() {
        registerSettings();
        injectCSS();
        initNetflixPlugin();
    }

    if (window.appready) {
        start();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                start();
            }
        });
    }
})();