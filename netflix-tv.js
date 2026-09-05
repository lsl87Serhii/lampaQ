(function () {
    'use strict';

    // Запобігаємо повторній реєстрації плагіна
    if (window.netflix_tv_appletv_loaded) return;
    window.netflix_tv_appletv_loaded = true;

    function initNetflixPlugin() {
        // 1. Реєстрація ЄДИНОГО параметра в Налаштуваннях -> Інтерфейс
        if (window.Lampa && Lampa.SettingsApi) {
            var hasParam = false;
            try {
                hasParam = !!Lampa.SettingsApi.getParam('netflix_tv_mode');
            } catch (e) {}

            if (!hasParam) {
                Lampa.SettingsApi.addParam({
                    component: 'interface',
                    param: {
                        name: 'netflix_tv_mode',
                        type: 'select',
                        values: {
                            'true': 'Увімкнено',
                            'false': 'Вимкнено'
                        },
                        default: 'true'
                    },
                    field: {
                        name: 'Netflix TV',
                        description: '4 картки в ряду, активна 16:9 зафіксована зліва'
                    },
                    onChange: function () {
                        applyNetflixLayout();
                    }
                });
            }
        }

        // 2. CSS під сітку 1920px (Apple TV WebKit)
        function applyNetflixLayout() {
            var styleId = 'netflix-tv-appletv-css';
            var existingStyle = document.getElementById(styleId);
            if (existingStyle) existingStyle.remove();

            var enabled = Lampa.Storage.get('netflix_tv_mode', 'true') === 'true';
            if (!enabled) return;

            var style = document.createElement('style');
            style.id = styleId;
            style.innerHTML = `
                /* 4 картки в ряду для сітки 1920px */
                .card {
                    width: 360px !important;
                    margin-right: 30px !important;
                    transition: width 0.2s ease-out !important;
                }

                /* Вертикальний постер для неактивних карток */
                .card .card__view {
                    padding-bottom: 140% !important;
                }

                /* Активна картка зліва: формат 16:9 */
                .card.focus {
                    width: 520px !important;
                    z-index: 100 !important;
                }

                .card.focus .card__view {
                    padding-bottom: 56.25% !important; /* 16:9 */
                }

                .card.focus img {
                    object-fit: cover !important;
                }

                /* Плавна анімація зсуву стрічки */
                .scroll__content {
                    transition: transform 0.25s ease-out !important;
                }
            `;
            document.head.appendChild(style);
        }

        applyNetflixLayout();

        // 3. Фіксація активної картки ліворуч при переході фокусу
        if (window.Lampa && Lampa.Listener) {
            Lampa.Listener.follow('target', function (e) {
                if (Lampa.Storage.get('netflix_tv_mode', 'true') !== 'true') return;

                if (e.type === 'focus' && e.target) {
                    var targetNode = e.target.nodeName ? e.target : (e.target[0] || e.target);
                    
                    if (targetNode && targetNode.classList && targetNode.classList.contains('card')) {
                        var container = targetNode.closest('.scroll__content');
                        if (container) {
                            var offsetLeft = targetNode.offsetLeft;
                            container.style.transform = 'translate3d(-' + offsetLeft + 'px, 0px, 0px)';
                        }
                    }
                }
            });
        }
    }

    // Запуск після готовності Lampa
    if (window.Lampa && window.Lampa.SettingsApi) {
        initNetflixPlugin();
    } else {
        document.addEventListener('appready', initNetflixPlugin);
    }
})();