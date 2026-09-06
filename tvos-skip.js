(function () {
    'use strict';

    if (window.tvos_skip_plugin) return;
    window.tvos_skip_plugin = true;

    // 1. Впровадження CSS-стилів анімації Netflix та кнопки для tvOS
    const style = document.createElement('style');
    style.innerHTML = `
        .tvos-skip-container {
            position: fixed;
            bottom: 80px;
            right: 60px;
            z-index: 999999;
            pointer-events: auto;
        }
        .tvos-skip-btn-wrap {
            position: relative;
            background: rgba(15, 15, 15, 0.9);
            border: 2px solid rgba(255, 255, 255, 0.4);
            border-radius: 10px;
            padding: 14px 28px;
            color: #ffffff;
            font-size: 20px;
            font-weight: 700;
            cursor: pointer;
            overflow: hidden;
            box-shadow: 0 8px 25px rgba(0,0,0,0.8);
            transition: transform 0.2s ease, border-color 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .tvos-skip-btn-wrap.focus, .tvos-skip-btn-wrap:focus {
            border-color: #e50914 !important;
            background: rgba(30, 30, 30, 0.95) !important;
            transform: scale(1.08) !important;
            box-shadow: 0 0 20px rgba(229, 9, 20, 0.8) !important;
        }
        .tvos-skip-progress-bar {
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            background: rgba(229, 9, 20, 0.6);
            width: 0%;
            z-index: 1;
        }
        .tvos-skip-btn-text {
            position: relative;
            z-index: 2;
            white-space: nowrap;
            text-shadow: 0 2px 4px rgba(0,0,0,0.9);
        }
        @keyframes tvos-fill-anim {
            0% { width: 0%; }
            100% { width: 100%; }
        }
    `;
    document.head.appendChild(style);

    // Допоміжна функція отримання налаштувань
    function getSetting(key, defaultValue) {
        if (typeof Lampa !== 'undefined' && Lampa.Storage) {
            let val = Lampa.Storage.get(key);
            if (val !== undefined && val !== null && val !== '') return val;
            let fval = Lampa.Storage.field(key);
            if (fval !== undefined && fval !== null && fval !== '') return fval;
        }
        return defaultValue;
    }

    // 2. Реєстрація окремого меню налаштувань "tvos-skip"
    function initSettingsMenu() {
        if (Lampa.SettingsApi) {
            Lampa.SettingsApi.addComponent({
                component: 'tvos_skip',
                name: 'tvos-skip',
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>'
            });

            Lampa.SettingsApi.addParam({
                component: 'tvos_skip',
                param: {
                    name: 'tvos_skip_intro',
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
                    description: 'Режим для вступних заставок'
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'tvos_skip',
                param: {
                    name: 'tvos_skip_credits',
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
                    description: 'Режим для фінальних титрів'
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'tvos_skip',
                param: {
                    name: 'tvos_skip_timer',
                    type: 'select',
                    values: {
                        '3': '3 секунди',
                        '5': '5 секунд',
                        '8': '8 секунд',
                        '10': '10 секунд'
                    },
                    default: '5'
                },
                field: {
                    title: 'Таймер заповнення',
                    description: 'Час анімації кнопки перед автопропуском'
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'tvos_skip',
                param: {
                    name: 'tvos_skip_debug',
                    type: 'select',
                    values: {
                        'true': 'Увімкнено',
                        'false': 'Вимкнено'
                    },
                    default: 'false'
                },
                field: {
                    title: 'Debug сповіщення',
                    description: 'Показувати статуси завантаження таймкодів'
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

    let skipContainer = null;
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
        if (skipContainer) {
            skipContainer.remove();
            skipContainer = null;
        }
    }

    // 3. Створення анімованої кнопки з авто-натисканням
    function createNetflixButton(title, onAction) {
        removeButton();

        const timerSec = parseInt(getSetting('tvos_skip_timer', '5')) || 5;

        skipContainer = $(`
            <div class="tvos-skip-container">
                <div class="tvos-skip-btn-wrap player-panel__button selector">
                    <div class="tvos-skip-progress-bar"></div>
                    <span class="tvos-skip-text">${title}</span>
                </div>
            </div>
        `);

        const progressBar = skipContainer.find('.tvos-skip-progress-bar');
        progressBar.css('animation', `tvos-fill-anim ${timerSec}s linear forwards`);

        const btnWrap = skipContainer.find('.tvos-skip-btn-wrap');

        // Подія натискання пульта Siri Remote або кліка
        btnWrap.on('hover:enter click', function (e) {
            if (e) e.stopPropagation();
            onAction();
            removeButton();
        });

        // Додавання на головний шар плеєра
        const playerElem = Lampa.Player.element();
        if (playerElem && playerElem.length) {
            playerElem.append(skipContainer);
        } else {
            $('body').append(skipContainer);
        }

        if (Lampa.Controller.current() === 'player') {
            Lampa.Controller.enable('player');
        }

        // АВТОПРОПУСК після завершення анімації
        btnTimer = setTimeout(function () {
            onAction();
            removeButton();
        }, timerSec * 1000);
    }

    // 4. Отримання таймкодів для фільмів та серіалів
    async function fetchTimecodes(mediaData) {
        if (state.fetched) return;

        try {
            const isMovie = !mediaData.season && (!mediaData.movie || !mediaData.movie.number_of_seasons);
            const mediaId = mediaData.movie ? mediaData.movie.id : (mediaData.id || null);

            if (!mediaId) return;

            let dbData = null;

            if (isMovie) {
                // Багаторівневі запити для фільмів
                const urls = [
                    `https://raw.githubusercontent.com/ipavlin98/lmp-series-skip-db/main/data/${mediaId}.json`,
                    `https://raw.githubusercontent.com/ipavlin98/lmp-series-skip-db/main/data/movies/${mediaId}.json`,
                    `https://raw.githubusercontent.com/vahagn-99/lampa-auto-skip/main/data/${mediaId}.json`
                ];

                for (let url of urls) {
                    try {
                        const res = await fetch(url);
                        if (res.ok) {
                            dbData = await res.json();
                            break;
                        }
                    } catch (err) {}
                }

                if (dbData) {
                    const introS = dbData.intro_start || (dbData.movie ? dbData.movie.intro_start : 0) || 0;
                    const introE = dbData.intro_end || (dbData.movie ? dbData.movie.intro_end : 0) || 0;
                    const creditsS = dbData.credits_start || (dbData.movie ? dbData.movie.credits_start : 0) || 0;

                    state.introStart = introS;
                    state.introEnd = introE;
                    state.creditsStart = creditsS;
                    state.active = (introE > 0 || creditsS > 0);
                }
            } else {
                // Серіали
                const url = `https://raw.githubusercontent.com/ipavlin98/lmp-series-skip-db/main/data/${mediaId}.json`;
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    const epKey = `s${mediaData.season}e${mediaData.episode}`;
                    dbData = data[epKey] || data[epKey.toLowerCase()];

                    if (dbData) {
                        state.introStart = dbData.intro_start || 0;
                        state.introEnd = dbData.intro_end || 0;
                        state.creditsStart = dbData.credits_start || 0;
                        state.active = (state.introEnd > 0 || state.creditsStart > 0);
                    }
                }
            }

            state.fetched = true;

            if (getSetting('tvos_skip_debug', 'false') === 'true') {
                if (state.active) {
                    Lampa.Noty.show(`tvos-skip: Таймкоди знайдено (End: ${state.introEnd}s)`);
                } else {
                    Lampa.Noty.show('tvos-skip: Таймкоди відсутні');
                }
            }
        } catch (e) {
            console.log('tvos-skip error:', e);
        }
    }

    // 5. Відстеження подій відтворення
    function initPlayerListeners() {
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
            const introMode = getSetting('tvos_skip_intro', 'button');
            const creditsMode = getSetting('tvos_skip_credits', 'button');

            // Обробка Інтро
            if (introMode !== 'off' && !state.introSkipped && state.introEnd > 0) {
                const inIntro = (state.introStart > 0)
                    ? (curTime >= state.introStart && curTime < state.introEnd)
                    : (curTime < state.introEnd);

                if (inIntro) {
                    if (introMode === 'auto') {
                        state.introSkipped = true;
                        Lampa.Player.to(state.introEnd);
                        Lampa.Noty.show('Вступ пропущено');
                    } else if (!skipContainer) {
                        createNetflixButton('Пропустити заставку', function () {
                            state.introSkipped = true;
                            Lampa.Player.to(state.introEnd);
                        });
                    }
                }
            }

            // Обробка Титрів
            if (creditsMode !== 'off' && !state.creditsTriggered && state.creditsStart > 0) {
                if (curTime >= state.creditsStart) {
                    if (creditsMode === 'auto') {
                        state.creditsTriggered = true;
                        Lampa.Player.stop();
                    } else if (!skipContainer) {
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

    // Запуск плагіна
    if (window.appready) {
        initSettingsMenu();
        initPlayerListeners();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                initSettingsMenu();
                initPlayerListeners();
            }
        });
    }
})();