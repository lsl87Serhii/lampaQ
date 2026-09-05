(function () {
    'use strict';

    if (window.netflix_tv_plugin_loaded) return;
    window.netflix_tv_plugin_loaded = true;

    // 1. Єдине налаштування в розділі "Інтерфейс" (За замовчуванням: УВІМКНЕНО)
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
            description: '4 картки в ряду з фіксованим фокусом 16:9 зліва'
        },
        onChange: function () {
            applyLayout();
        }
    });

    // 2. CSS-стилі: робимо 4 картки на екран та активну картку зліва 16:9
    function injectStyles() {
        if (document.getElementById('netflix-tv-styles')) return;

        var style = document.createElement('style');
        style.id = 'netflix-tv-styles';
        style.innerHTML = `
            /* Макет на 4 карточки в ряду */
            body.netflix-tv-active .card {
                width: 22vw !important;
                margin-right: 1.5vw !important;
                transition: transform 0.2s ease, width 0.2s ease, aspect-ratio 0.2s ease !important;
            }

            /* Зафіксована активна картка зліва з пропорцією 16:9 */
            body.netflix-tv-active .card.focus {
                width: 28vw !important;
                aspect-ratio: 16 / 9 !important;
                transform: scale(1) !important;
                z-index: 10 !important;
            }

            /* Фіксований зсув стрічки: фокус залишається зліва, контент зсувається */
            body.netflix-tv-active .items {
                scroll-behavior: smooth !important;
            }
        `;
        document.head.appendChild(style);
    }

    // 3. Застосування режиму за замовчуванням
    function applyLayout() {
        var enabled = Lampa.Storage.get('netflix_tv_mode', 'true') === 'true';
        if (enabled) {
            document.body.classList.add('netflix-tv-active');
        } else {
            document.body.classList.remove('netflix-tv-active');
        }
    }

    // Ініціалізація
    injectStyles();
    applyLayout();

    // Залізобетонна фіксація фокусу зліва при навігації
    Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') {
            applyLayout();
        }
    });
})();