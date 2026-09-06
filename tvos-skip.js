(function () {
    'use strict';

    if (window.lampa_tvos_skip_plugin) return;
    window.lampa_tvos_skip_plugin = true;

    // Конфігурація за замовчуванням
    const CONFIG = {
        autoSkipIntro: false,    // true = автоматичний пропуск, false = показ кнопки
        autoSkipCredits: false,  // true = автоматичне закриття на титрах, false = показ кнопки
        durationTolerance: 10,   // Похибка тривалості фільму у секундах (±10сек)
        buttonTimeout: 8000      // Час відображення кнопки (в мілісекундах)
    };

    let state = {
        introStart: 0,
        introEnd: 0,
        creditsStart: 0,
        active: false,
        introSkipped: false,
        creditsTriggered: false
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
            creditsTriggered: false
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

    // Створення кнопки з класом .selector для сумісності з пультами tvOS
    function createButton(title, action) {
        removeButton();

        skipBtn = $(`
            <div class="player-panel__button selector tvos-skip-btn" style="
                position: absolute;
                bottom: 90px;
                right: 40px;
                z-index: 999;
                background: rgba(15, 15, 15, 0.9);
                border: 2px solid rgba(255, 255, 255, 0.6);
                padding: 12px 24px;
                border-radius: 10px;
                color: #ffffff;
                font-size: 18px;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            ">
                <span>${title}</span>
            </div>
        `);

        // Подія кліка або вибору джойстиком
        skipBtn.on('hover:enter click', function () {
            action();
            removeButton();
        });

        // Вбудовуємо в нативну панель Lampa.Player
        const panel = Lampa.Player.panel();
        if (panel && panel.find('.player-panel__body').length) {
            panel.find('.player-panel__body').append(skipBtn);
        } else {
            $('body').append(skipBtn);
        }

        // Активація фокусу пульта
        if (Lampa.Controller.current() === 'player') {
            Lampa.Controller.enable('player');
        }

        // Автоматичне приховування через таймаут
        btnTimer = setTimeout(removeButton, CONFIG.buttonTimeout);
    }

    // Асинхронне отримання таймкодів з бази
    async function fetchTimecodes(mediaData) {
        resetState();

        try {
            const isMovie = !mediaData.season;
            const mediaId = mediaData.movie ? mediaData.movie.id : null;
            if (!mediaId) return;

            // Джерело таймкодів (база lmp-series-skip-db)
            const url = `https://raw.githubusercontent.com/ipavlin98/lmp-series-skip-db/main/data/${mediaId}.json`;
            const response = await fetch(url);
            if (!response.ok) return;

            const dbData = await response.json();

            if (isMovie) {
                const duration = Lampa.Player.duration(); // Загальна тривалість файлу
                if (dbData.duration && Math.abs(duration - dbData.duration) <= CONFIG.durationTolerance) {
                    state.introStart = dbData.intro_start || 0;
                    state.introEnd = dbData.intro_end || 0;
                    state.creditsStart = dbData.credits_start || 0;
                    state.active = true;
                }
            } else {
                const epKey = `s${mediaData.season}e${mediaData.episode}`;
                const epData = dbData[epKey];
                if (epData) {
                    state.introStart = epData.intro_start || 0;
                    state.introEnd = epData.intro_end || 0;
                    state.creditsStart = epData.credits_start || 0;
                    state.active = true;
                }
            }
        } catch (e) {
            console.log('TvOSSkip:', 'Таймкоди не знайдені або помилка мережі', e);
        }
    }

    // Відстеження подій плеєра
    function initListeners() {
        Lampa.Player.listener.follow('ready', function () {
            const data = Lampa.Player.data();
            if (data) fetchTimecodes(data);
        });

        Lampa.Player.listener.follow('timeupdate', function (e) {
            if (!state.active) return;

            const curTime = e.current;

            // 1. Початок або проходження Інтро
            if (!state.introSkipped && state.introEnd > 0) {
                const inIntroRange = (state.introStart > 0)
                    ? (curTime >= state.introStart && curTime < state.introEnd)
                    : (curTime < state.introEnd);

                if (inIntroRange) {
                    if (CONFIG.autoSkipIntro) {
                        state.introSkipped = true;
                        Lampa.Player.to(state.introEnd);
                        Lampa.Noty.show('Заставку пропущено');
                    } else if (!skipBtn) {
                        createButton('Пропустити заставку', function () {
                            state.introSkipped = true;
                            Lampa.Player.to(state.introEnd);
                        });
                    }
                }
            }

            // 2. Початок титрів
            if (!state.creditsTriggered && state.creditsStart > 0) {
                if (curTime >= state.creditsStart) {
                    if (CONFIG.autoSkipCredits) {
                        state.creditsTriggered = true;
                        Lampa.Player.stop();
                    } else if (!skipBtn) {
                        createButton('Пропустити титри', function () {
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

    // Реєстрація плагіна
    if (window.appready) {
        initListeners();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') initListeners();
        });
    }
})();