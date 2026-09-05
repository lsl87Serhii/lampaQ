(function () {
    'use strict';

    if (window.netflix_tv_loaded) return;
    window.netflix_tv_loaded = true;

    // 1. Очищення дублікатів та реєстрація єдиного параметра
    Lampa.SettingsApi.addParam({
        component: 'interface',
        param: {
            name: 'netflix_tv_layout',
            type: 'select',
            values: {
                'true': 'Увімкнено',
                'false': 'Вимкнено'
            },
            default: 'true'
        },
        field: {
            name: 'Netflix TV',
            description: '4 картки в ряду, перша 16:9 зафіксована зліва'
        },
        onChange: function () {
            toggleState();
        }
    });

    // 2. CSS для 4 карток та пропорцій 16:9 для активної
    function injectStyles() {
        if (document.getElementById('netflix-tv-style')) return;
        var style = document.createElement('style');
        style.id = 'netflix-tv-style';
        style.innerHTML = `
            /* Стандартна картка (зменшена, щоб у ряду вміщалося 4) */
            body.netflix-tv-active .card {
                width: 21vw !important;
                min-width: 21vw !important;
                margin-right: 1.2vw !important;
                transition: all 0.25s cubic-bezier(0.25, 1, 0.5, 1) !important;
            }

            /* Активна картка зліва у форматі 16:9 */
            body.netflix-tv-active .card.focus {
                width: 28vw !important;
                min-width: 28vw !important;
                z-index: 100 !important;
            }

            body.netflix-tv-active .card.focus .card__view {
                padding-bottom: 56.25% !important; /* Пропорція 16:9 */
            }

            body.netflix-tv-active .card.focus img {
                object-fit: cover !important;
            }
        `;
        document.head.appendChild(style);
    }

    function toggleState() {
        var active = Lampa.Storage.get('netflix_tv_layout', 'true') === 'true';
        if (active) {
            document.body.classList.add('netflix-tv-active');
        } else {
            document.body.classList.remove('netflix-tv-active');
        }
    }

    // 3. Перехоплення фокусу: блокуємо рамку зліва і зсуваємо сам контент
    function bindScrollEngine() {
        Lampa.Listener.follow('target', function (e) {
            if (!document.body.classList.contains('netflix-tv-active')) return;

            if (e.type === 'focus' && e.target && e.target.classList.contains('card')) {
                var card = e.target;
                var container = card.closest('.scroll__content') || card.closest('.items');

                if (container) {
                    var offset = card.offsetLeft;
                    container.style.transition = 'transform 0.3s ease-out';
                    container.style.transform = 'translate3d(-' + offset + 'px, 0px, 0px)';
                }
            }
        });
    }

    // Запуск
    injectStyles();
    toggleState();
    bindScrollEngine();

    Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') {
            toggleState();
        }
    });
})();