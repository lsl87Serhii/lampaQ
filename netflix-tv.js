(function () {
    'use strict';

    // 1. Офіційна реєстрація в Налаштування -> Інтерфейс
    function addSettings() {
        if (window.Lampa && Lampa.SettingsApi) {
            Lampa.SettingsApi.addParam({
                component: 'interface',
                param: {
                    name: 'netflix_interface_mode',
                    type: 'select',
                    values: {
                        true: 'Увімкнено',
                        false: 'Вимкнено'
                    },
                    default: 'true'
                },
                field: {
                    name: 'Стиль Netflix TV',
                    description: 'Горизонтальний фокус 16:9 та авто-вивід опису'
                },
                onChange: function (value) {
                    Lampa.Storage.set('netflix_interface_mode', value);
                    if (window.Lampa && Lampa.Noty) {
                        Lampa.Noty.show('Перезапустіть Lampa для застосування дій');
                    }
                }
            });
        }
    }

    // 2. Безпечні CSS-стилі (без зламу навігації пульта)
    function injectCSS() {
        if (document.getElementById('lampa-netflix-fixed-css')) return;

        var style = document.createElement('style');
        style.id = 'lampa-netflix-fixed-css';
        style.innerHTML = `
            /* Загальний темний стиль */
            body, .background, .activity {
                background-color: #141414 !important;
            }

            /* Червоний логотип N у шапці */
            .head__logo-netflix {
                color: #E50914;
                font-size: 28px;
                font-weight: 900;
                margin-left: auto;
                padding-right: 20px;
                font-family: sans-serif;
            }

            /* Базовий вигляд вертикальних карток */
            .card {
                transition: transform 0.25s cubic-bezier(0.25, 1, 0.5, 1), box-shadow 0.25s ease !important;
            }

            .card .card__view {
                border-radius: 6px !important;
                overflow: hidden !important;
            }

            /* Ефект активної картки у стилі Netflix (підсвічування та масштабування) */
            .card.focus {
                transform: scale(1.08) !important;
                z-index: 100 !important;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.9), 0 0 0 2px #FFFFFF !important;
            }

            /* Інформаційна панель під стрічкою контенту */
            .nf-info-panel {
                padding: 12px 20px;
                margin: 5px 0 15px 0;
                background: rgba(20, 20, 20, 0.85);
                border-radius: 6px;
                color: #FFFFFF;
                animation: nfFadeIn 0.2s ease-in-out;
            }

            .nf-info-panel .nf-title {
                font-size: 18px;
                font-weight: bold;
                margin-bottom: 4px;
                color: #FFFFFF;
            }

            .nf-info-panel .nf-meta {
                font-size: 13px;
                color: #A3A3A3;
                margin-bottom: 6px;
                display: flex;
                gap: 10px;
            }

            .nf-info-panel .nf-rating {
                color: #46d369;
                font-weight: bold;
            }

            .nf-info-panel .nf-description {
                font-size: 13px;
                color: #CCCCCC;
                line-height: 1.35;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }

            @keyframes nfFadeIn {
                from { opacity: 0; transform: translateY(-3px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    // 3. Динамічна робота з картками та шапкою
    function initLogic() {
        // Перевіряємо чи увімкнено плагін у налаштуваннях
        var enabled = Lampa.Storage.get('netflix_interface_mode', 'true');
        if (enabled === 'false' || enabled === false) return;

        // Додаємо логотип "N" у верхній бар
        var head = document.querySelector('.head');
        if (head && !head.querySelector('.head__logo-netflix')) {
            var logo = document.createElement('div');
            logo.className = 'head__logo-netflix';
            logo.innerText = 'N';
            head.appendChild(logo);
        }

        // Відстежуємо фокусування на картках
        Lampa.Listener.follow('card', function (e) {
            if (e.type === 'focus') {
                renderInfoPanel(e.target, e.data);
            }
        });
    }

    function renderInfoPanel(cardElement, data) {
        if (!cardElement || !data) return;

        // Знаходимо батьківський контейнер ряду
        var row = cardElement.closest('.items__body') || cardElement.closest('.category-full__body');
        if (!row) return;

        var panel = row.nextElementSibling;
        if (!panel || !panel.classList.contains('nf-info-panel')) {
            panel = document.createElement('div');
            panel.className = 'nf-info-panel';
            row.parentNode.insertBefore(panel, row.nextSibling);
        }

        var title = data.title || data.name || '';
        var year = (data.release_date || data.first_air_date || '').substring(0, 4);
        var rating = data.vote_average ? `★ ${data.vote_average.toFixed(1)}` : '98% збіг';
        var overview = data.overview || 'Натисніть OK для перегляду детальної інформації.';

        panel.innerHTML = `
            <div class="nf-title">${title}</div>
            <div class="nf-meta">
                <span class="nf-rating">${rating}</span>
                ${year ? `<span>• ${year}</span>` : ''}
                <span>• Netflix Layout</span>
            </div>
            <div class="nf-description">${overview}</div>
        `;
    }

    // Старт плагіна після повного завантаження Lampa
    function startPlugin() {
        addSettings();
        injectCSS();
        initLogic();
    }

    if (window.appready) {
        startPlugin();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                startPlugin();
            }
        });
    }
})();