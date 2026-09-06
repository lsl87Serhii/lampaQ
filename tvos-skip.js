(function () {
    'use strict';

    if (window.lampa_tvos_skip_v2) return;
    window.lampa_tvos_skip_v2 = true;

    // Впровадження CSS стилів для анімації кнопки в стилі Netflix
    const style = document.createElement('style');
    style.innerHTML = `
        .tvos-skip-btn {
            position: absolute;
            bottom: 90px;
            right: 50px;
            z-index: 1000;
            background: rgba(20, 20, 20, 0.85);
            border: 2px solid rgba(255, 255, 255, 0.5);
            border-radius: 8px;
            padding: 12px 28px;
            color: #fff;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.7);
            transition: transform 0.2s, border-color 0.2s;
        }
        .tvos-skip-btn.focus {
            border-color: #e50914 !important;
            transform: scale(1.05);
        }
        .tvos-skip-progress {
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            background: rgba(229, 9, 20, 0.4);
            width: 0%;
            z-index: 1;
        }
        .tvos-skip-text {
            position: relative;
            z-index: 2;
        }
        @keyframes netflix-fill {
            from { width: 0%; }
            to { width: 100%; }
        }
    `;
    document.head.appendChild(style);

    // Ініціалізація налаштувань у меню Lampa (Налаштування -> Плеєр)
    function initSettings() {
        if (Lampa.SettingsApi) {
            Lampa.SettingsApi.addParam({
                component: 'player',
                param: {
                    name: 'skip_intro_mode',
                    type: 'select',
                    values: {
                        'button': 'Кнопка з таймером',
                        'auto': 'Автоматично',
                        'off': 'Вимкнено'
                    },
                    default: 'button'
                },
                field: {
                    title: 'Пропуск інтро',
                    description: 'Режим обробки вступних заставок'
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'player',
                param: {
                    name: 'skip_credits_mode',
                    type: 'select',
                    values: {
                        'button': 'Кнопка з таймером',
                        'auto': 'Автоматично',
                        'off': 'Вимкнено'
                    },
                    default: 'button'
                },
                field: {
                    title: 'Пропуск титрів',
                    description: 'Режим обробки фінальних титрів'
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'player',
                param: {
                    name: 'skip_timer_sec',
                    type: 'select',
                    values: {
                        '3': '3 секунди',
                        '5': '5 секунд',
                        '8': '8 секунд'
                    },
                    default: '5'
                },
                field: {
                    title: 'Таймер кнопки',
                    description: 'Час до автоматичного спрацьовування кнопки'
                }
            });
        }
    }

    let state = {
        introStart: 0,
        introEnd: 0,
        creditsStart: 0,
        active: false,
        introSkipped: false,
        creditsTriggered: false,
        fetched: false
    };

    let skipBtn = null;
    let btnTimer = null;

    function resetState() {
        state = {
            introStart: 0,
            introEnd: 0,
            creditsStart: 0,
            active: false,
            introSkipped: false,
            creditsTriggered: false,
            fetched: false
        };
        removeButton();
    }

    function removeButton() {
        if (btnTimer) {
            clearTimeout(btnTimer);
            btnTimer = null;
        }
        if (skipBtn) {
            skipBtn.remove();
            skipBtn = null;
        }
    }

    // Створення анімованої кнопки в стилі Netflix
    function createNetflixButton(text, onComplete) {
        removeButton();

        const timerSec = parseInt(Lampa.Storage.get('skip_timer_sec', '5')) || 5;

        skipBtn = $(`
            <div class="tvos-skip-btn player-panel__button selector">
                <div class="tvos-skip-progress"></div>
                <span class="tvos-skip-text">${text}</span>
            </div>
        `);

        // Запуск CSS-анімації заповнення
        skipBtn.find('.tvos-skip-progress').css({
            'animation': `netflix-fill ${timerSec}s linear forwards`
        });

        // Натискання з пульта
        skipBtn.on('hover:enter click', function () {
            onComplete();
            removeButton();
        });

        // Додавання в панель плеєра
        const body = Lampa.Player.panel().find('.player-panel__body');
        if (body.length) {
            body.append(skipBtn);
        } else {
            $('body').append(skipBtn);
        }

        if (Lampa.Controller.current() === 'player') {
            Lampa.Controller.enable('player');
        }

        // Автоматичне спрацьовування після закінчення анімації
        btnTimer = setTimeout(function () {
            onComplete();
            removeButton();
        }, timerSec * 1000);
    }

    // Отримання таймкодів (серіали + фільми)
    async function fetchTimecodes(mediaData) {
        if (state.fetched) return;
        
        try {
            const isMovie = !mediaData.season;
            const mediaId = mediaData.movie ? mediaData.movie.id : null;
            if (!mediaId) return;

            let dbData = null;

            if (isMovie) {
                // Спроба отримати таймкоди для фільму (IntroDB / fallback)
                const movieUrl = `https://raw.githubusercontent.com/ipavlin98/lmp-series-skip-db/main/data/movies/${mediaId}.json`;
                const response = await fetch(movieUrl);
                if (response.ok) {
                    dbData = await response.json();
                    const duration = Lampa.Player.duration();
                    
                    // Перевірка тривалості
                    if (dbData.duration && duration > 0 && Math.abs(duration - dbData.duration) <= 15) {
                        state.introStart = dbData.intro_start || 0;
                        state.introEnd = dbData.intro_end || 0;
                        state.creditsStart = dbData.credits_start || 0;
                        state.active = true;
                    }
                }
            } else {
                // Серіали
                const tvUrl = `https://raw.githubusercontent.com/ipavlin98/lmp-series-skip-db/main/data/${mediaId}.json`;
                const response = await fetch(tvUrl);
                if (response.ok) {
                    const res = await response.json();
                    const epKey = `s${mediaData.season}e${mediaData.episode}`;
                    dbData = res[epKey];
                    if (dbData) {
                        state.introStart = dbData.intro_start || 0;
                        state.introEnd = dbData.intro_end || 0;
                        state.creditsStart = dbData.credits_start || 0;
                        state.active = true;
                    }
                }
            }
            state.fetched = true;
        } catch (e) {
            console.log('SkipPlugin:', 'Помилка завантаження баз', e);
        }
    }

    // Слухач плеєра
    function initListeners() {
        Lampa.Player.listener.follow('ready', function () {
            resetState();
            const data = Lampa.Player.data();
            if (data) fetchTimecodes(data);
        });

        Lampa.Player.listener.follow('timeupdate', function (e) {
            const data = Lampa.Player.data();
            if (data && !state.fetched) {
                fetchTimecodes(data);
            }

            if (!state.active) return;

            const curTime = e.current;
            const introMode = Lampa.Storage.get('skip_intro_mode', 'button');
            const creditsMode = Lampa.Storage.get('skip_credits_mode', 'button');

            // 1. Вступ (Intro)
            if (introMode !== 'off' && !state.introSkipped && state.introEnd > 0) {
                const inIntro = (state.introStart > 0)
                    ? (curTime >= state.introStart && curTime < state.introEnd)
                    : (curTime < state.introEnd);

                if (inIntro) {
                    if (introMode === 'auto') {
                        state.introSkipped = true;
                        Lampa.Player.to(state.introEnd);
                        Lampa.Noty.show('Заставку пропущено');
                    } else if (!skipBtn) {
                        createNetflixButton('Пропустити заставку', function () {
                            state.introSkipped = true;
                            Lampa.Player.to(state.introEnd);
                        });
                    }
                }
            }

            // 2. Титри (Credits)
            if (creditsMode !== 'off' && !state.creditsTriggered && state.creditsStart > 0) {
                if (curTime >= state.creditsStart) {
                    if (creditsMode === 'auto') {
                        state.creditsTriggered = true;
                        Lampa.Player.stop();
                    } else if (!skipBtn) {
                        createNetflixButton('Пропустити титри', function () {
                            state.creditsTriggered = true;
                            Lampa.Player.stop();
                        });
                    }
                }
            }
        });

        Lampa.Player.listener.follow('destroy', function () {
            resetState();
        });
    }

    // Старт плагіна
    if (window.appready) {
        initSettings();
        initListeners();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                initSettings();
                initListeners();
            }
        });
    }
})();