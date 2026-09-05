(function () {
    'use strict';

    // 1. Інтеграція налаштувань у меню Lampa (Налаштування -> Інтерфейс)
    function registerSettings() {
        if (window.Lampa && Lampa.Settings) {
            Lampa.Settings.addParam({
                component: 'interface',
                param: {
                    name: 'netflix_tv_layout',
                    type: 'select',
                    values: {
                        enabled: 'Увімкнено',
                        disabled: 'Вимкнено'
                    },
                    default: 'enabled'
                },
                field: {
                    name: 'Netflix TV Layout (16:9 зліва)',
                    description: 'Фіксована картка 16:9 зліва, 3 вертикальні картки праворуч та опис'
                },
                onChange: function (value) {
                    Lampa.Noty.show('Налаштування збережено. Перезавантажте додаток.');
                }
            });
        }
    }

    // 2. Стилі точної копії інтерфейсу з відео
    function injectStyles() {
        if (document.getElementById('lampa-netflix-tv-styles')) return;

        var style = document.createElement('style');
        style.id = 'lampa-netflix-tv-styles';
        style.innerHTML = `
            :root {
                --nf-bg: #141414;
                --nf-red: #E50914;
                --nf-white: #FFFFFF;
                --nf-gray-text: #A3A3A3;
            }

            body, .background, .activity {
                background-color: var(--nf-bg) !important;
            }

            /* --- Шапка у стилі Netflix --- */
            .head {
                background: linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                padding: 20px 50px !important;
            }

            .head__logo-n {
                color: var(--nf-red);
                font-size: 32px;
                font-weight: 900;
                font-family: sans-serif;
                margin-left: auto;
            }

            /* --- Контейнер ряду / Карусель --- */
            .items__body, .category-full__body {
                display: flex !important;
                align-items: flex-start !important;
                gap: 16px !important;
                padding-left: 50px !important;
                overflow: visible !important;
            }

            /* Неактивні вертикальні картки (3 праворуч) */
            .card {
                width: 145px !important;
                height: 218px !important;
                flex-shrink: 0 !important;
                border-radius: 6px !important;
                transition: all 0.3s cubic-bezier(0.25, 1, 0.5, 1) !important;
                overflow: hidden !important;
            }

            .card .card__view {
                border-radius: 6px !important;
                width: 100% !important;
                height: 100% !important;
            }

            .card .card__img {
                object-fit: cover !important;
                width: 100% !important;
                height: 100% !important;
            }

            /* АКТИВНА КАРТКА: Завжди 16:9 та переміщується на першу позицію зліва */
            .card.focus {
                width: 388px !important; /* Формат 16:9 за висоти 218px */
                height: 218px !important;
                order: -1 !important; /* Завжди виштовхується на лівий край ряду */
                box-shadow: 0 12px 30px rgba(0,0,0,0.9), 0 0 0 2px var(--nf-white) !important;
                z-index: 50 !important;
            }

            /* --- Блок опису під активним рядом --- */
            .nf-row-details {
                padding: 12px 50px 20px 50px;
                color: var(--nf-white);
                max-width: 850px;
            }

            .nf-row-details .nf-meta {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 14px;
                color: var(--nf-gray-text);
                margin-bottom: 8px;
            }

            .nf-row-details .nf-green-match {
                color: #46d369;
                font-weight: bold;
            }

            .nf-row-details .nf-overview {
                font-size: 14px;
                line-height: 1.45;
                color: #d2d2d2;
                margin-bottom: 10px;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }

            .nf-row-details .nf-recommend-badge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: rgba(255, 255, 255, 0.12);
                padding: 5px 12px;
                border-radius: 4px;
                font-size: 12px;
                color: #ffffff;
            }
        `;
        document.head.appendChild(style);
    }

    // 3. Динамічна заміна постера на 16:9 кадр та вивід опису
    function initTVLogic() {
        // Додаємо логотип N у шапку
        var head = document.querySelector('.head');
        if (head && !head.querySelector('.head__logo-n')) {
            var logo = document.createElement('div');
            logo.className = 'head__logo-n';
            logo.innerText = 'N';
            head.appendChild(logo);
        }

        Lampa.Listener.follow('card', function (e) {
            if (e.type === 'focus') {
                var card = e.target;
                var data = e.data || {};

                // Підставляємо горизонтальний Backdrop при фокусі на картці зліва
                if (data.backdrop_path || data.background) {
                    var img = card.querySelector('.card__img');
                    if (img) {
                        if (!card.dataset.verticalSrc) card.dataset.verticalSrc = img.src;
                        var wideSrc = Lampa.TMDB ? Lampa.TMDB.image('backdrop', data.backdrop_path, 'w780') : (data.background || img.src);
                        img.src = wideSrc;
                    }
                }

                updateDetailsBlock(card, data);
            }

            if (e.type === 'blur') {
                var card = e.target;
                // Повертаємо вертикальний постер, коли картка виходить із фокусу
                if (card && card.dataset.verticalSrc) {
                    var img = card.querySelector('.card__img');
                    if (img) img.src = card.dataset.verticalSrc;
                    delete card.dataset.verticalSrc;
                }
            }
        });
    }

    function updateDetailsBlock(card, data) {
        var row = card.closest('.items__body') || card.closest('.category-full__body');
        if (!row) return;

        var detailsBox = row.nextElementSibling;
        if (!detailsBox || !detailsBox.classList.contains('nf-row-details')) {
            detailsBox = document.createElement('div');
            detailsBox.className = 'nf-row-details';
            row.parentNode.insertBefore(detailsBox, row.nextSibling);
        }

        var type = data.name ? 'Серіал' : 'Фільм';
        var year = (data.release_date || data.first_air_date || '').substring(0, 4) || '2026';
        var rating = data.vote_average ? `★ ${data.vote_average.toFixed(1)}` : '98% збіг';
        var overview = data.overview || 'Опис доступний при відкритті деталей контенту.';

        detailsBox.innerHTML = `
            <div class="nf-meta">
                <span>${type}</span> •
                <span>${year}</span> •
                <span class="nf-green-match">${rating}</span> •
                <span>16+</span>
            </div>
            <div class="nf-overview">${overview}</div>
            <div class="nf-recommend-badge">👍 Гадаємо, вам це дуже сподобається</div>
        `;
    }

    // Запуск після ініціалізації Lampa
    if (window.appready) {
        registerSettings();
        injectStyles();
        initTVLogic();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                registerSettings();
                injectStyles();
                initTVLogic();
            }
        });
    }
})();