(function () {
    'use strict';

    function initLampaNetflixEngine() {
        // 1. Повна очистка від стандартних елементів Lampa та впровадження стилів
        var styleId = 'lampa-netflix-real-tv-style';
        var oldStyle = document.getElementById(styleId);
        if (oldStyle) oldStyle.remove();

        var style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            /* Повністю приховуємо стандартну шапку Lampa (іконки, годинник, профіль) */
            .head__logo, .head__title, .head__time, .head__profile, 
            .head__settings, .head__notice, .head__action, .head__actions,
            .head__menu, .head__icons {
                display: none !important;
            }

            /* Фіксована центрована шапка Netflix (єдина активна на екрані) */
            .head {
                background: linear-gradient(180deg, rgba(15,15,15,0.98) 0%, rgba(15,15,15,0) 100%) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                position: fixed !important;
                top: 0; left: 0; right: 0;
                z-index: 2000 !important;
                height: 65px !important;
                padding: 0 40px !important;
            }

            .nfx-head-bar {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 12px !important;
                width: 100% !important;
            }

            .nfx-head-item {
                color: #a3a3a3;
                font-size: 15px;
                padding: 6px 18px;
                border-radius: 20px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            /* Підсвічування кнопки пульта ТВ при переході вгору */
            .nfx-head-item.focus, .nfx-head-item:focus {
                background-color: #ffffff !important;
                color: #000000 !important;
                font-weight: bold !important;
                transform: scale(1.05) !important;
            }

            .nfx-head-item.active {
                color: #ffffff;
            }

            /* Контейнери каруселі */
            .scroll__content, .items__layer, .scroll__body {
                overflow: hidden !important;
            }

            .items-line__body, .items__body {
                display: flex !important;
                align-items: flex-start !important;
                gap: 16px !important;
                padding-left: 50px !important;
                transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1) !important;
                will-change: transform !important;
            }

            /* Звичайні вертикальні картки (рівно 3 праворуч від активної) */
            .card {
                width: 145px !important;
                height: 218px !important;
                flex-shrink: 0 !important;
                border-radius: 6px !important;
                transition: width 0.3s ease, height 0.3s ease, opacity 0.2s ease !important;
                overflow: hidden !important;
                border: none !important;
                margin: 0 !important;
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

            /* ФІКСОВАНА АКТИВНА КАРТКА 16:9 ЗЛІВА (Завжди в першому слоті) */
            .card.focus {
                width: 388px !important; /* Пропорція 16:9 при висоті 218px */
                height: 218px !important;
                box-shadow: 0 12px 30px rgba(0,0,0,0.95), 0 0 0 3px #FFFFFF !important;
                z-index: 100 !important;
            }

            /* ПРИХОВУЄМО ВСІ КАРТКИ, КРІМ 1 ВЕЛИКОЇ ТА 3 ВЕРТИКАЛЬНИХ */
            .card.nfx-hide-card {
                display: none !important;
            }

            .card:not(.focus) .card__title, 
            .card:not(.focus) .card__age,
            .card:not(.focus) .card__quality,
            .card:not(.focus) .card__vote {
                display: none !important;
            }

            /* Панель метаданих під каруселлю */
            .nfx-info-block {
                padding: 15px 50px 20px 50px;
                color: #ffffff;
                max-width: 850px;
            }

            .nfx-info-block .nfx-title {
                font-size: 24px;
                font-weight: 800;
                margin-bottom: 6px;
            }

            .nfx-info-block .nfx-meta {
                display: flex;
                align-items: center;
                gap: 10px;
                font-size: 14px;
                color: #a3a3a3;
                margin-bottom: 8px;
            }

            .nfx-info-block .nfx-match {
                color: #46d369;
                font-weight: bold;
            }

            .nfx-info-block .nfx-desc {
                font-size: 14px;
                line-height: 1.4;
                color: #cccccc;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                overflow: hidden;
                margin-bottom: 8px;
            }

            .nfx-info-block .nfx-badge {
                display: inline-block;
                background: rgba(255,255,255,0.15);
                padding: 4px 10px;
                border-radius: 4px;
                font-size: 12px;
                color: #fff;
            }
        `;
        document.head.appendChild(style);

        // 2. Встановлення інтерактивної шапки
        setupHeader();

        // 3. Відстеження фокусу та підтягування каруселі
        Lampa.Listener.follow('card', function (e) {
            if (e.type === 'focus') {
                var card = e.target;
                var data = e.data || {};

                // Примусовий зсув стрічки ліворуч, щоб активний елемент зафіксувався зліва
                positionCarouselFixedLeft(card);

                // Заміна постера на 16:9 кадр
                if (data.backdrop_path || data.background) {
                    var img = card.querySelector('.card__img');
                    if (img) {
                        if (!card.dataset.verticalPoster) card.dataset.verticalPoster = img.src;
                        var backdropUrl = Lampa.TMDB ? Lampa.TMDB.image('backdrop', data.backdrop_path, 'w780') : (data.background || img.src);
                        img.src = backdropUrl;
                    }
                }

                renderInfo(card, data);
            }

            if (e.type === 'blur') {
                var card = e.target;
                if (card && card.dataset.verticalPoster) {
                    var img = card.querySelector('.card__img');
                    if (img) img.src = card.dataset.verticalPoster;
                    delete card.dataset.verticalPoster;
                }
            }
        });
    }

    // Впровадження активної шапки для ТВ-пульта
    function setupHeader() {
        var head = document.querySelector('.head');
        if (!head) return;

        head.innerHTML = '';

        var bar = document.createElement('div');
        bar.className = 'nfx-head-bar';
        bar.innerHTML = `
            <div class="nfx-head-item focusable" data-action="search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                Пошук
            </div>
            <div class="nfx-head-item focusable active" data-action="home">Головна</div>
            <div class="nfx-head-item focusable" data-action="tv">Серіали</div>
            <div class="nfx-head-item focusable" data-action="movie">Фільми</div>
            <div class="nfx-head-item focusable" data-action="settings">Налаштування</div>
        `;
        head.appendChild(bar);

        var items = bar.querySelectorAll('.nfx-head-item');
        items.forEach(function(item) {
            item.addEventListener('click', function() {
                var act = item.getAttribute('data-action');
                if (act === 'search') Lampa.Search.open();
                else if (act === 'home') Lampa.Activity.push({ title: 'Головна', component: 'main' });
                else if (act === 'tv') Lampa.Activity.push({ title: 'Серіали', component: 'tv' });
                else if (act === 'movie') Lampa.Activity.push({ title: 'Фільми', component: 'movie' });
                else if (act === 'settings') Lampa.Activity.push({ title: 'Налаштування', component: 'settings' });
            });
        });
    }

    // Жорстка фіксація 16:9 слота зліва + залишаємо тільки 3 картки праворуч
    function positionCarouselFixedLeft(activeCard) {
        var row = activeCard.closest('.items__body') || activeCard.closest('.items-line__body') || activeCard.closest('.category-full__body');
        if (!row) return;

        var cards = Array.from(row.children);
        var activeIdx = cards.indexOf(activeCard);

        if (activeIdx !== -1) {
            // Крок зсуву стрічки: 145px (ширина малого постеру) + 16px gap = 161px
            var shiftPixels = activeIdx * 161;
            row.style.transform = 'translate3d(-' + shiftPixels + 'px, 0, 0)';

            // Відображаємо рівно 1 активну 16:9 + 3 вертикальні праворуч (разом 4 елементи)
            cards.forEach(function(c, i) {
                if (i >= activeIdx && i <= activeIdx + 3) {
                    c.classList.remove('nfx-hide-card');
                } else {
                    c.classList.add('nfx-hide-card');
                }
            });
        }
    }

    function renderInfo(card, data) {
        var row = card.closest('.items__body') || card.closest('.items-line__body') || card.closest('.category-full__body');
        if (!row) return;

        var parent = row.parentNode;
        var info = parent.querySelector('.nfx-info-block');
        if (!info) {
            info = document.createElement('div');
            info.className = 'nfx-info-block';
            parent.insertBefore(info, row.nextSibling);
        }

        var title = data.title || data.name || '';
        var type = data.name ? 'Серіал' : 'Фільм';
        var year = (data.release_date || data.first_air_date || '').substring(0, 4) || '2026';
        var rating = data.vote_average ? Math.round(data.vote_average * 10) + '% збіг' : '98% збіг';
        var overview = data.overview || 'Опис доступний при перегляді деталей.';

        info.innerHTML = `
            <div class="nfx-title">${title}</div>
            <div class="nfx-meta">
                <span class="nfx-match">${rating}</span>
                <span>${year}</span>
                <span>${type}</span>
                <span>16+</span>
            </div>
            <div class="nfx-desc">${overview}</div>
            <div class="nfx-badge">👍 Гадаємо, вам це дуже сподобається</div>
        `;
    }

    function registerInSettings() {
        if (window.Lampa && Lampa.SettingsApi) {
            Lampa.SettingsApi.addComponent({
                component: 'nfx_fixed_tv',
                name: 'Netflix TV Layout (Fixed)',
                icon: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>'
            });

            Lampa.SettingsApi.addParam({
                component: 'nfx_fixed_tv',
                param: {
                    name: 'nfx_fixed_enabled',
                    type: 'select',
                    values: { 'true': 'Увімкнено', 'false': 'Вимкнено' },
                    default: 'true'
                },
                field: { name: 'Статус плагіна' },
                onChange: function() { initLampaNetflixEngine(); }
            });
        }
    }

    function start() {
        registerInSettings();
        initLampaNetflixEngine();
    }

    if (window.appready) {
        start();
    } else if (window.Lampa && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
        setTimeout(start, 600);
    }
})();