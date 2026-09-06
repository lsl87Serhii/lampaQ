(function () {
    'use strict';

    if (window.tvos_skip_plugin_final) return;
    window.tvos_skip_plugin_final = true;

    // 1. Ізольовані CSS стилі поверх усіх шарів tvOS
    const style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.innerHTML = `
        #tvos-skip-root {
            position: fixed !important;
            bottom: 90px !important;
            right: 70px !important;
            z-index: 9999999 !important;
            display: block !important;
            opacity: 1 !important;
            visibility: visible !important;
            pointer-events: auto !important;
        }
        .tvos-skip-btn {
            position: relative;
            background: rgba(15, 15, 15, 0.95);
            border: 2px solid rgba(255, 255, 255, 0.5);
            border-radius: 10px;
            padding: 14px 28px;
            color: #ffffff;
            font-size: 20px;
            font-weight: bold;
            font-family: sans-serif;
            cursor: pointer;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s, border-color 0.2s;
        }
        .tvos-skip-btn.focus, .tvos-skip-btn:focus {
            border-color: #e50914 !important;
            background: rgba(35, 35, 35, 0.98) !important;
            transform: scale(1.08) !important;
            box-shadow: 0 0 25px rgba(229, 9, 20, 0.9) !important;
        }
        .tvos-skip-bar {
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            background: #e50914;
            opacity: 0.65;
            width: 0%;
            z-index: 1;
        }
        .tvos-skip-txt {
            position: relative;
            z-index: 2;
            white-space: nowrap;
            text-shadow: 0 2px 4px rgba(0,0,0,0.9);
        }
        @keyframes tvosFill {
            0% { width: 0%; }
            100% { width: 100%; }
        }
    `;
    document.head.appendChild(style);

    function getVal(key, def) {
        if (typeof Lampa !== 'undefined' && Lampa.Storage) {
            let v = Lampa.Storage.get(key);
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return def;
    }

    // 2. Реєстрація меню налаштувань tvos-skip
    function initSettings() {
        if (typeof Lampa !== 'undefined' && Lampa.SettingsApi) {
            Lampa.SettingsApi.addComponent({
                component: 'tvos_skip',
                name: 'tvos-skip',
                icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>'
            });

            Lampa.SettingsApi.addParam({
                component: 'tvos_skip',
                param: {
                    name: 'tvos_skip_demo',
                    type: 'select',
                    values: {
                        'true': 'Увімкнено (Тест на всіх відео)',
                        'false': 'Вимкнено (Тільки з бази)'
                    },
                    default: 'false'
                },
                field: {
                    title: 'Тестовий режим (Demo)',
                    description: 'Форсує інтро (з 5 по 25 сек) для перевірки кнопки на будь-якому контенті'
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'tvos_skip',
                param: {
                    name: 'tvos_skip_intro_mode',
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
                    description: 'Режим обробки заставок'
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'tvos_skip',
                param: {
                    name: 'tvos_skip_credits_mode',
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
                component: 'tvos_skip',
                param: {
                    name: 'tvos_skip_timer',
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
                    description: 'Час анімації кнопки перед автопропуском'
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

    let buttonElem = null;
    let autoTimer = null;
    let monitorInterval = null;

    function reset() {
        state = {
            introStart: 0,
            introEnd: 0,
            creditsStart: 0,
            active: false,
            introSkipped: false,
            creditsTriggered: false,
            fetched: false
        };
        hideBtn();
        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }
    }

    function hideBtn() {
        if (autoTimer) {
            clearTimeout(autoTimer);
            autoTimer = null;
        }
        if (buttonElem) {
            buttonElem.remove();
            buttonElem = null;
        }
    }

    // 3. Відображення анімованої кнопки
    function showButton(title, callback) {
        hideBtn();

        const sec = parseInt(getVal('tvos_skip_timer', '5')) || 5;

        const $btn = $(`
            <div id="tvos-skip-root">
                <div class="tvos-skip-btn selector">
                    <div class="tvos-skip-bar" style="animation: tvosFill ${sec}s linear forwards;"></div>
                    <span class="tvos-skip-txt">${title}</span>
                </div>
            </div>
        `);

        buttonElem = $btn;

        $btn.find('.tvos-skip-btn').on('hover:enter click', function (e) {
            if (e) e.stopPropagation();
            callback();
            hideBtn();
        });

        $('body').append($btn);

        if (typeof Lampa !== 'undefined' && Lampa.Controller) {
            Lampa.Controller.enable('player');
        }

        // Автоматичне виконання після закінчення анімації
        autoTimer = setTimeout(function () {
            callback();
            hideBtn();
        }, sec * 1000);
    }

    // 4. Завантаження таймкодів
    async function loadTimecodes(pData) {
        if (state.fetched) return;

        const isDemo = getVal('tvos_skip_demo', 'false') === 'true';

        // Форсований режим для тестування
        if (isDemo) {
            state.introStart = 5;
            state.introEnd = 25;
            state.creditsStart = 300;
            state.active = true;
            state.fetched = true;
            if (typeof Lampa !== 'undefined' && Lampa.Noty) {
                Lampa.Noty.show('tvos-skip: Активовано ДЕМО-режим (5-25сек)');
            }
            return;
        }

        try {
            const movieObj = pData.movie || pData.card || pData;
            const mediaId = movieObj ? (movieObj.tmdb_id || movieObj.id) : null;
            const isTV = !!(pData.season || pData.episode || (movieObj && movieObj.number_of_seasons));

            if (!mediaId) return;

            if (isTV) {
                const s = pData.season || (pData.movie && pData.movie.season) || 1;
                const e = pData.episode || (pData.movie && pData.movie.episode) || 1;

                const url = `https://raw.githubusercontent.com/ipavlin98/lmp-series-skip-db/main/data/${mediaId}.json`;
                const res = await fetch(url);
                if (res.ok) {
                    const db = await res.json();
                    const key = `s${s}e${e}`;
                    const ep = db[key] || db[key.toLowerCase()];
                    if (ep) {
                        state.introStart = ep.intro_start || 0;
                        state.introEnd = ep.intro_end || 0;
                        state.creditsStart = ep.credits_start || 0;
                        state.active = true;
                    }
                }
            }
            state.fetched = true;
        } catch (err) {
            console.log('tvos-skip fetch error', err);
        }
    }

    function getCurrentTime() {
        if (typeof Lampa === 'undefined' || !Lampa.Player) return 0;
        if (typeof Lampa.Player.time === 'function') {
            let t = Lampa.Player.time();
            if (typeof t === 'object' && t !== null) return t.current || 0;
            if (typeof t === 'number') return t;
        }
        return 0;
    }

    // 5. Перевірка стану поточного часу відтворення
    function checkPlaybackState() {
        if (!state.active) return;

        const curTime = getCurrentTime();
        if (!curTime || curTime <= 0) return;

        const introMode = getVal('tvos_skip_intro_mode', 'button');
        const creditsMode = getVal('tvos_skip_credits_mode', 'button');

        // Обробка Інтро
        if (introMode !== 'off' && !state.introSkipped && state.introEnd > 0) {
            const inRange = state.introStart > 0
                ? (curTime >= state.introStart && curTime < state.introEnd)
                : (curTime < state.introEnd);

            if (inRange) {
                if (introMode === 'auto') {
                    state.introSkipped = true;
                    Lampa.Player.to(state.introEnd);
                    if (Lampa.Noty) Lampa.Noty.show('Інтро пропущено');
                } else if (!buttonElem) {
                    showButton('Пропустити заставку', function () {
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
                } else if (!buttonElem) {
                    showButton('Пропустити титри', function () {
                        state.creditsTriggered = true;
                        Lampa.Player.stop();
                    });
                }
            }
        }
    }

    // Незалежне опитування плеєра кожні 500мс
    function startMonitoring() {
        if (monitorInterval) clearInterval(monitorInterval);
        monitorInterval = setInterval(function () {
            if (typeof Lampa !== 'undefined' && Lampa.Player) {
                const pData = Lampa.Player.data();
                if (pData && !state.fetched) {
                    loadTimecodes(pData);
                }
                checkPlaybackState();
            }
        }, 500);
    }

    function initListeners() {
        if (typeof Lampa === 'undefined' || !Lampa.Player) return;

        Lampa.Player.listener.follow('ready', function () {
            reset();
            const pData = Lampa.Player.data();
            if (pData) loadTimecodes(pData);
            startMonitoring();
        });

        Lampa.Player.listener.follow('destroy', function () {
            reset();
        });
    }

    if (window.appready) {
        initSettings();
        initListeners();
    } else {
        if (typeof Lampa !== 'undefined' && Lampa.Listener) {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') {
                    initSettings();
                    initListeners();
                }
            });
        }
    }
})();