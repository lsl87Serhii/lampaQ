(function () {
    'use strict';

    // 1. Інтеграція в меню Налаштування -> Інтерфейс
    function registerSettings() {
        if (window.Lampa && Lampa.SettingsApi) {
            Lampa.SettingsApi.addParam({
                component: 'interface',
                param: {
                    name: 'netflix_exact_layout',
                    type: 'select',
                    values: {
                        true: 'Увімкнено',
                        false: 'Вимкнено'
                    },
                    default: 'true'
                },
                field: {
                    name: 'Точний стиль Netflix TV',
                    description: 'Фіксований фокус 16:9 зліва, карусель, центрована шапка'
                },
                onChange: function (val) {
                    Lampa.Storage.set('netflix_exact_layout', val);
                    if (window.Lampa && Lampa.Noty) {
                        Lampa.Noty.show('Перезапустіть Lampa');
                    }
                }
            });
        }
    }

    // 2. CSS Стилі exact Netflix TV
    function injectCSS() {
        if (document.getElementById('lampa-netflix-exact-css')) return;

        var style = document.createElement('style');
        style.id = 'lampa-netflix-exact-css';
        style.innerHTML = `
            /* Темний фон */
            body, .background, .activity, .scroll {
                background-color: #141414 !important;
            }

            /* --- ЦЕНТРОВАНА ШАПКА NETFLIX --- */
            .head__title, .head__time, .head__profile, .head__settings, .head__notice, .head__action {
                display: none !important;
            }

            .head {
                background: linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0) 100%) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                position: fixed !important;
                top: 0; left: 0; right: 0;
                z-index: 1000 !important;
                height: 70px !important;
                padding: 0 40px !important;
            }

            .nf-exact-header {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 100%;
                position: relative;
            }

            .nf-exact-nav {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 16px;
            }

            .nf-nav-btn {
                color: #a3a3a3;
                font-size: 16px;
                padding: 6px 16px;
                border-radius: 20px;
                font-weight: 500;
                transition: all 0.2s ease;
            }

            .nf-nav-btn.active {
                background-color: rgba(255, 255, 255, 0.25);
                color: #ffffff;
                font-weight: bold;
            }

            .nf-exact-logo {
                position: absolute;
                right: 10px;
                color: #E50914;
                font-size: 32px;
                font-weight: 900;
                font-family: sans-serif;
            }

            /* --- КАРУСЕЛЬ КАРТОК З ЗАКРІПЛЕНИМ ФОКУСОМ ЗЛІВА --- */
            .items__body, .category-full__body, .scroll__body {
                overflow: visible !important;
            }

            .items__layer, .scroll__content {
                padding-left: 60px !important;
            }

            /* Рядок карток (плавний зсув при каруселі) */
            .items__body {
                display: flex !important;
                align-items: flex-start !important;
                gap: 16px !important;
                transition: transform 0.35s cubic-bezier(0.25, 1, 0.5, 1) !important;
            }

            /* Неактивні вертикальні картки (3 праворуч) */
            .card {
                width: 140px !important;
                height: 210px !important;
                flex-shrink: 0 !important;
                border-radius: 6px !important;
                transition: width 0.3s ease, height 0.3s ease, transform 0.3s ease !important;
                overflow: hidden !important;
                border: none !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
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

            /* АКТИВНА КАРТКА: Закріплюється у лівому слоті та розгортається в 16:9 */
            .card.focus {
                width: 373px !important; /* 16:9 пропорція при висоті 210px */
                height: 210px !important;
                border-radius: 8px !important;
                box-shadow: 0 12px 32px rgba(0,0,0,0.95), 0 0 0 3px #FFFFFF !important;
                z-index: 100 !important;
            }

            /* Приховуємо службові тексти з малих карток */
            .card:not(.focus) .card__title, 
            .card:not(.focus) .card__age,
            .card:not(.focus) .card__quality {
                display: none !important;
            }

            /* --- ДИНАМІЧНИЙ БЛОК ОПИСУ ПІД АКТИВНОЮ КАРУСЕЛЛЮ --- */
            .nf-exact-details {
                padding: 15px 60px 25px 60px;
                color: #ffffff;
                max-width: 850px;
                animation: nfSlideUp 0.25s cubic-bezier(0.25, 1, 0.5, 1);
            }

            .nf-exact-details .nf-title {
                font-size: 24px;
                font-weight: 800;
                margin-bottom: 6px;
                color: #ffffff;
            }

            .nf-exact-details .nf-meta {
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 14px;
                color: #a3a3a3;
                margin-bottom: 8px;
            }

            .nf-exact-details .nf-match {
                color: #46d369;
                font-weight: bold;
            }

            .nf-exact-details .nf-overview {
                font-size: 14px;
                line-height: 1.45;
                color: #cccccc;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                overflow: hidden;
                margin-bottom: 12px;
            }

            .nf-exact-details .nf-badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: rgba(255, 255, 255, 0.15);
                padding: 6px 14px;
                border-radius: 4px;
                font-size: 13px;
                color: #ffffff;
                font-weight: 500;
            }

            @keyframes nfSlideUp {
                from { opacity: 0; transform: translateY(6px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    // 3. Логіка центрованої шапки та підтягування каруселі під ліву рамку
    function initLogic() {
        var enabled = Lampa.Storage.get('netflix_exact_layout', 'true');
        if (enabled === 'false' || enabled === false) return;

        setupHeader();

        Lampa.Listener.follow('card', function (e) {
            if (e.type === 'focus') {
                var card = e.target;
                var data = e.data || {};

                // 1. Повертаємо ряд так, щоб активна картка була зафіксована зліва
                alignCardToLeft(card);

                // 2. Підставляємо 16:9 Backdrop
                if (data.backdrop_path || data.background) {
                    var img = card.querySelector('.card__img');
                    if (img) {
                        if (!card.dataset.posterSrc) card.dataset.posterSrc = img.src;
                        var backdropUrl = Lampa.TMDB ? Lampa.TMDB.image('backdrop', data.backdrop_path, 'w780') : (data.background || img.src);
                        img.src = backdropUrl;
                    }
                }

                // 3. Малюємо блок опису
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

    // Зсув каруселі ліворуч, щоб активний елемент залишався в першому слоті
    function alignCardToLeft(card) {
        var row = card.closest('.items__body') || card.closest('.category-full__body');
        if (!row) return;

        var cards = Array.from(row.children);
        var index = cards.indexOf(card);

        if (index !== -1) {
            // Крок зсуву: неактивна картка 140px + gap 16px = 156px
            var offset = index * 156;
            row.style.transform = `translateX(-${offset}px)`;
        }
    }

    function setupHeader() {
        var head = document.querySelector('.head');
        if (!head || head.querySelector('.nf-exact-header')) return;

        var headerEl = document.createElement('div');
        headerEl.className = 'nf-exact-header';
        headerEl.innerHTML = `
            <div class="nf-exact-nav">
                <div class="nf-nav-btn active">Головна</div>
                <div class="nf-nav-btn">Серіали</div>
                <div class="nf-nav-btn">Фільми</div>
                <div class="nf-nav-btn">Мій Netflix</div>
            </div>
            <div class="nf-exact-logo">N</div>
        `;
        head.appendChild(headerEl);
    }

    function renderDetailsPanel(card, data) {
        var row = card.closest('.items__body') || card.closest('.category-full__body');
        if (!row) return;

        var parent = row.parentNode;
        var panel = parent.querySelector('.nf-exact-details');
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'nf-exact-details';
            parent.insertBefore(panel, row.nextSibling);
        }

        var title = data.title || data.name || '';
        var type = data.name ? 'Серіал' : 'Фільм';
        var year = (data.release_date || data.first_air_date || '').substring(0, 4) || '2026';
        var rating = data.vote_average ? `${Math.round(data.vote_average * 10)}% збіг` : '98% збіг';
        var overview = data.overview || 'Опис доступний при відкритті детальної сторінки.';

        panel.innerHTML = `
            <div class="nf-title">${title}</div>
            <div class="nf-meta">
                <span class="nf-match">${rating}</span>
                <span>${year}</span>
                <span>${type}</span>
                <span>16+</span>
            </div>
            <div class="nf-overview">${overview}</div>
            <div class="nf-badge">👍 Гадаємо, вам це дуже сподобається</div>
        `;
    }

    function start() {
        registerSettings();
        injectCSS();
        initLogic();
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