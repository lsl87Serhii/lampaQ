(function () {
    'use strict';

    /* ================================================================
     *  NFX Autoskip — v1.2
     *  Пропуск заставки і перехід на наступну серію в стилі Netflix.
     *
     *  Як це працює:
     *    Публічної бази таймкодів заставок/титрів для фільмів і
     *    серіалів не існує (у Netflix вони розмічені вручну). Тому
     *    плагін вчиться на тобі: коли ти сам перемотуєш уперед на
     *    початку або в кінці серії, він запамʼятовує це для всього
     *    серіалу і далі робить сам.
     *
     *  Використовує тільки внутрішній плеєр Lampa:
     *    Lampa.PlayerVideo (timeupdate, to), Lampa.PlayerPlaylist,
     *    Lampa.Player (start/destroy, render), Lampa.Controller.
     *  Звірено з вихідниками yumata/lampa-source.
     * ================================================================ */

    var PLUGIN_ID = 'nfx_autoskip';
    var VERSION = '1.2';
    var CSS_ID = 'nfx-autoskip-css';

    // Межі зон навчання (частка тривалості файлу)
    var HEAD_ZONE = 0.20;   // заставка/«у попередніх серіях» шукаються тут
    var TAIL_ZONE = 0.70;   // титри шукаються тут

    var MIN_INTRO = 15;     // коротші перемотки не вважаємо заставкою
    var MAX_INTRO = 300;
    var MIN_TAIL = 20;      // коротші хвости не вважаємо титрами
    var MAX_TAIL = 400;

    // =================================================================
    //  Утиліти
    // =================================================================

    function S(name, def) {
        try { return Lampa.Storage.get(name, def); } catch (e) { return def; }
    }

    function setS(name, value) {
        try { Lampa.Storage.set(name, value); } catch (e) { /* ignore */ }
    }

    function isOn(name, def) {
        var v = S(name, def);
        return v === true || v === 'true' || v === 1 || v === '1';
    }

    function num(name, def) {
        var v = parseFloat(S(name, def));
        return isNaN(v) ? parseFloat(def) : v;
    }

    function lang() {
        var l = S('language', 'uk');
        return l === 'ua' ? 'uk' : l;
    }

    function toNode(x) {
        if (!x) return null;
        return x.nodeType ? x : (x[0] || null);
    }

    function el(tag, cls) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        return n;
    }

    function remove(node) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
    }

    // =================================================================
    //  Тексти
    // =================================================================

    var I18N = {
        uk: {
            title: 'NFX Autoskip',
            skip_intro: 'Пропустити заставку',
            next_ep: 'Наступна серія',
            finish: 'Завершити',
            learned_intro: 'Заставку запамʼятано',
            learned_tail: 'Титри запамʼятовано',
            s_intro: 'Пропускати заставку',
            s_next: 'Перехід на наступну серію на титрах',
            s_learn: 'Навчання на моїх перемотках',
            s_delay: 'Затримка перед автодією',
            s_tail: 'Титри за замовчуванням (до навчання)',
            s_movie: 'Показувати кнопку і для фільмів',
            s_reset: 'Скинути вивчене',
            s_reset_d: 'Забути заставки й титри всіх серіалів',
            off: 'Вимкнено',
            done: 'Готово',
            s_debug: 'Показувати діагностику в плеєрі',
            s_show: 'Що вивчено',
            s_show_d: 'Показати збережені мітки',
            nothing: 'Поки нічого не вивчено',
            m_intro: 'заставка',
            m_tail: 'титри',
            s_check: 'Перевірити сумісність плеєра',
            s_check_d: 'Запусти відео, потім натисни тут',
            c_time: 'час',
            c_seek: 'перемотка',
            c_next: 'наст. серія',
            c_ui: 'кнопка',
            c_src: 'джерело'
        },
        ru: {
            title: 'NFX Autoskip',
            skip_intro: 'Пропустить заставку',
            next_ep: 'Следующая серия',
            finish: 'Завершить',
            learned_intro: 'Заставка запомнена',
            learned_tail: 'Титры запомнены',
            s_intro: 'Пропускать заставку',
            s_next: 'Переход на следующую серию на титрах',
            s_learn: 'Обучение на моих перемотках',
            s_delay: 'Задержка перед автодействием',
            s_tail: 'Титры по умолчанию (до обучения)',
            s_movie: 'Показывать кнопку и для фильмов',
            s_reset: 'Сбросить выученное',
            s_reset_d: 'Забыть заставки и титры всех сериалов',
            off: 'Выключено',
            done: 'Готово',
            s_debug: 'Показывать диагностику в плеере',
            s_show: 'Что выучено',
            s_show_d: 'Показать сохранённые метки',
            nothing: 'Пока ничего не выучено',
            m_intro: 'заставка',
            m_tail: 'титры',
            s_check: 'Проверить совместимость плеера',
            s_check_d: 'Запусти видео, затем нажми здесь',
            c_time: 'время',
            c_seek: 'перемотка',
            c_next: 'след. серия',
            c_ui: 'кнопка',
            c_src: 'источник'
        },
        en: {
            title: 'NFX Autoskip',
            skip_intro: 'Skip intro',
            next_ep: 'Next episode',
            finish: 'Finish',
            learned_intro: 'Intro length saved',
            learned_tail: 'Credits length saved',
            s_intro: 'Skip intro',
            s_next: 'Jump to next episode on credits',
            s_learn: 'Learn from my seeks',
            s_delay: 'Delay before auto action',
            s_tail: 'Default credits length (before learning)',
            s_movie: 'Show the button for movies too',
            s_reset: 'Reset learned data',
            s_reset_d: 'Forget intros and credits for all series',
            off: 'Off',
            done: 'Done',
            s_debug: 'Show diagnostics in player',
            s_show: 'What is learned',
            s_show_d: 'Show stored marks',
            nothing: 'Nothing learned yet',
            m_intro: 'intro',
            m_tail: 'credits',
            s_check: 'Check player compatibility',
            s_check_d: 'Start a video, then press here',
            c_time: 'time',
            c_seek: 'seek',
            c_next: 'next ep',
            c_ui: 'button',
            c_src: 'source'
        }
    };

    function t(k) {
        var d = I18N[lang()] || I18N.en;
        return d[k] || I18N.en[k] || k;
    }

    // =================================================================
    //  Памʼять по серіалах
    // =================================================================

    var Memory = {
        KEY: 'nfxsk_marks',

        all: function () {
            var v = S(this.KEY, {});
            return (v && typeof v === 'object') ? v : {};
        },

        get: function (id) {
            if (!id) return null;
            return this.all()[id] || null;
        },

        put: function (id, field, value) {
            if (!id) return;
            var all = this.all();
            var rec = all[id] || {};
            rec[field] = value;
            rec.at = Date.now();
            all[id] = rec;
            setS(this.KEY, all);
        },

        clear: function () {
            setS(this.KEY, {});
        }
    };

    /** Ідентифікатор серіалу/фільму, під яким зберігаємо мітки */
    function seriesId() {
        try {
            var act = Lampa.Activity.active();
            var card = act && (act.movie || act.card);
            if (card && card.id) return (card.name ? 'tv' : 'mv') + card.id;
        } catch (e) { /* ignore */ }

        try {
            var pl = Lampa.PlayerPlaylist.get();
            if (pl && pl.length && pl[0].title) {
                // назва першого файлу без номера серії — стабільна для сезону
                return 'ttl' + pl[0].title.replace(/[0-9]+/g, '').replace(/\s+/g, '').slice(0, 40);
            }
        } catch (e) { /* ignore */ }

        return null;
    }

    // =================================================================
    //  Кнопка (перевикористовує рідні класи .player-skip)
    // =================================================================

    var Button = {
        node: null,
        line: null,
        text: null,
        timer: null,
        raf: null,
        action: null,
        shownAt: 0,

        build: function () {
            if (this.node) return this.node;

            var box = el('div', 'player-skip nfx-skip selector hide');

            var text = el('span', 'player-skip__text');
            var progress = el('div', 'player-skip__progress');
            var line = el('div', 'player-skip__progress-line');

            progress.appendChild(line);
            box.appendChild(text);
            box.appendChild(progress);

            var self = this;
            var fire = function () { self.run(); };
            try { $(box).on('hover:enter', fire); } catch (e) { /* ignore */ }
            box.addEventListener('hover:enter', fire);
            box.addEventListener('click', fire);

            this.node = box;
            this.line = line;
            this.text = text;

            return box;
        },

        mount: function () {
            var root = toNode(Lampa.Player.render());
            if (!root) return false;

            var box = this.build();
            if (box.parentNode !== root) root.appendChild(box);
            return true;
        },

        /**
         * Показати кнопку з відліком.
         * @param {string} label  текст кнопки
         * @param {function} action що зробити після відліку або по натисканню
         */
        show: function (label, action) {
            if (!this.mount()) return;

            // вже показана з тією ж дією — не перезапускаємо відлік
            if (this.action && this.node.getAttribute('data-nfx-label') === label) return;

            this.action = action;
            this.shownAt = Date.now();
            this.node.setAttribute('data-nfx-label', label);
            this.text.textContent = label;
            this.node.classList.remove('hide');

            this.focus();
            this.countdown(num('nfx_sk_delay', '4') * 1000);
        },

        countdown: function (ms) {
            var self = this;

            clearTimeout(this.timer);
            cancelAnimationFrame(this.raf);

            if (ms <= 0) return this.run();

            var start = Date.now();

            var step = function () {
                if (!self.action) return;
                var left = Math.max(0, 1 - (Date.now() - start) / ms);
                self.line.style.transform = 'scaleX(' + left + ')';
                self.line.style.webkitTransform = 'scaleX(' + left + ')';
                if (left > 0) self.raf = requestAnimationFrame(step);
            };

            this.line.style.transition = 'none';
            step();

            this.timer = setTimeout(function () { self.run(); }, ms);
        },

        run: function () {
            var action = this.action;
            this.hide();
            if (action) action();
        },

        focus: function () {
            try {
                if (Lampa.Controller.enabled().name === 'player') Lampa.Controller.toggle('nfx_skip');
            } catch (e) { /* ignore */ }
        },

        hide: function () {
            clearTimeout(this.timer);
            cancelAnimationFrame(this.raf);

            this.action = null;

            if (this.node) {
                this.node.classList.add('hide');
                this.node.classList.remove('focus');
                this.node.removeAttribute('data-nfx-label');
            }

            try {
                if (Lampa.Controller.enabled().name === 'nfx_skip') Lampa.Controller.toggle('player');
            } catch (e) { /* ignore */ }
        },

        destroy: function () {
            this.hide();
            remove(this.node);
            this.node = null;
        },

        controller: function () {
            var self = this;
            try {
                Lampa.Controller.add('nfx_skip', {
                    toggle: function () {
                        var root = toNode(Lampa.Player.render());
                        Lampa.Controller.collectionSet(root);
                        Lampa.Controller.collectionFocus(self.node, root);
                    },
                    enter: function () { self.run(); },
                    up: function () { Lampa.Controller.toggle('player'); },
                    down: function () { Lampa.Controller.toggle('player'); },
                    left: function () { Lampa.Controller.toggle('player'); },
                    right: function () { Lampa.Controller.toggle('player'); },
                    gone: function () { if (self.node) self.node.classList.remove('focus'); },
                    back: function () { self.hide(); Lampa.Controller.toggle('player'); }
                });
            } catch (e) {
                console.log('[NFX Autoskip] controller', e);
            }
        }
    };


    // =================================================================
    //  Джерело часу
    //  Внутрішній HTML5-плеєр Lampa і нативні плеєри обгорток (tvOS Pro,
    //  Universal, Online) звітують по-різному. Пробуємо все, що є, і
    //  беремо перше робоче.
    // =================================================================

    var Clock = {
        source: '—',
        poller: null,
        videoAt: 0,     // коли востаннє приходила подія від HTML5-плеєра

        can: function () {
            return {
                video_events: !!(window.Lampa && Lampa.PlayerVideo && Lampa.PlayerVideo.listener),
                video_elem: !!(window.Lampa && Lampa.PlayerVideo && typeof Lampa.PlayerVideo.video === 'function'),
                seek: !!(window.Lampa && Lampa.PlayerVideo && typeof Lampa.PlayerVideo.to === 'function'),
                timeline: !!(window.Lampa && Lampa.Timeline && Lampa.Timeline.listener),
                next: !!(window.Lampa && Lampa.PlayerPlaylist && typeof Lampa.PlayerPlaylist.next === 'function'),
                render: !!toNode(window.Lampa && Lampa.Player && Lampa.Player.render && Lampa.Player.render())
            };
        },

        feed: function (source, current, duration) {
            if (source === 'video') this.videoAt = Date.now();
            // події HTML5-плеєра мають пріоритет, але тільки поки вони живі:
            // з нативним плеєром вони можуть замовкнути назавжди
            else if (this.videoAt && Date.now() - this.videoAt < 3000) return;

            this.source = source;
            Engine.tick(current || 0, duration || 0);
        },

        startPolling: function () {
            var self = this;
            clearInterval(this.poller);
            this.videoAt = 0;

            this.poller = setInterval(function () {
                if (self.source === 'video') return;

                var v = null;
                try { v = Lampa.PlayerVideo.video(); } catch (e) { /* ignore */ }
                if (!v || !v.duration || isNaN(v.duration)) return;

                self.feed('poll', v.currentTime || 0, v.duration);
            }, 700);
        },

        stopPolling: function () {
            clearInterval(this.poller);
            this.poller = null;
        },

        bind: function () {
            var self = this;

            if (window.Lampa && Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
                Lampa.PlayerVideo.listener.follow('timeupdate', function (e) {
                    try { self.feed('video', e.current, e.duration); } catch (err) { /* ignore */ }
                });

                Lampa.PlayerVideo.listener.follow('rewind', function () {
                    try { Engine.onRewind(); } catch (err) { /* ignore */ }
                });
            }

            if (window.Lampa && Lampa.Timeline && Lampa.Timeline.listener) {
                Lampa.Timeline.listener.follow('update', function (e) {
                    try {
                        var road = e && e.data && e.data.road;
                        if (!road || !road.duration) return;
                        self.feed('timeline', road.time, road.duration);
                    } catch (err) { /* ignore */ }
                });
            }
        }
    };

    // =================================================================
    //  Ядро
    // =================================================================

    var Engine = {
        id: null,
        marks: null,
        duration: 0,
        last: 0,
        introDone: false,
        tailDone: false,
        acted: false,

        prev: 0,            // значення до останнього тіку
        prevAt: 0,          // коли прийшов попередній тік (Date.now)
        rewinding: false,   // триває покрокова перемотка
        rewindFrom: 0,
        rewindTo: 0,
        rewindTimer: null,
        selfSeek: 0,        // час нашої власної перемотки — її не вчимо

        reset: function () {
            this.id = null;
            this.marks = null;
            this.duration = 0;
            this.last = 0;
            this.prev = 0;
            this.prevAt = 0;
            this.rewinding = false;
            this.selfSeek = 0;
            clearTimeout(this.rewindTimer);
            this.introDone = false;
            this.tailDone = false;
            this.acted = false;
            Button.hide();
        },

        start: function () {
            this.reset();

            var self = this;
            // плейлист і активність готові не миттєво
            setTimeout(function () {
                self.id = seriesId();
                self.marks = Memory.get(self.id) || {};
            }, 300);
        },

        isSeries: function () {
            try {
                var pl = Lampa.PlayerPlaylist.get();
                return !!(pl && pl.length > 1);
            } catch (e) { return false; }
        },

        canNext: function () {
            try { return !!Lampa.PlayerPlaylist.canNext(); } catch (e) { return false; }
        },

        /** Ручна перемотка користувача — джерело навчання */
        learn: function (from, to) {
            if (!isOn('nfx_sk_learn', true) || !this.id || !this.duration) return;

            var jump = to - from;
            if (jump <= 0) return;

            // перемотка на початку → довжина заставки
            if (to <= this.duration * HEAD_ZONE && jump >= MIN_INTRO && to <= MAX_INTRO) {
                Memory.put(this.id, 'intro', Math.round(to));
                this.marks.intro = Math.round(to);
                this.notify(t('learned_intro'));
                return;
            }

            // перемотка в кінці → довжина титрів
            if (from >= this.duration * TAIL_ZONE) {
                var tail = Math.round(this.duration - from);
                if (tail >= MIN_TAIL && tail <= MAX_TAIL) {
                    Memory.put(this.id, 'tail', tail);
                    this.marks.tail = tail;
                    this.notify(t('learned_tail'));
                }
            }
        },

        notify: function (text) {
            try { Lampa.Noty.show(text); } catch (e) { /* ignore */ }
        },

        /** Момент початку титрів у секундах, або 0 якщо невідомо */
        tailStart: function () {
            var learned = this.marks && this.marks.tail;
            var fallback = num('nfx_sk_tail', '0');
            var tail = learned || fallback;
            if (!tail || !this.duration) return 0;
            return Math.max(0, this.duration - tail);
        },

        tick: function (current, duration) {
            if (!current) return;

            if (duration && duration !== this.duration) this.duration = duration;
            if (!this.duration) return;

            var prev = this.last;
            var now = Date.now();
            var elapsed = this.prevAt ? (now - this.prevAt) / 1000 : 0;

            this.prev = prev;
            this.last = current;
            this.prevAt = now;

            this.debug(current);

            // під час покрокової перемотки нічого не робимо —
            // підсумок підіб'ємо, коли вона завершиться
            if (this.rewinding) return;

            // Стрибок = позиція зросла більше, ніж минуло реального часу.
            // Так детекція не залежить від того, як часто джерело шле час
            // (HTML5 шле щосекунди, таймлайн — раз на кілька десятків секунд).
            var jumped = prev && (Math.abs(current - prev) - elapsed > 5);

            if (jumped) {
                var mine = this.selfSeek && Math.abs(current - this.selfSeek) < 5;
                this.selfSeek = 0;

                if (!mine && current > prev) this.learn(prev, current);

                if (current < prev) {
                    this.acted = false;
                    this.tailDone = false;
                }

                Button.hide();
                return;
            }

            this.checkIntro(current);
            this.checkTail(current);
        },

        /**
         * Покрокова перемотка Lampa: кожне натискання шле свій timeupdate,
         * а currentTime міняється лише через секунду після останнього.
         * Тому вчимося на підсумку всієї сесії, а не на окремому кроці.
         */
        onRewind: function () {
            var self = this;

            if (!this.rewinding) {
                this.rewinding = true;
                this.rewindFrom = this.prev || this.last;
            }

            this.rewindTo = this.last;

            Button.hide();

            clearTimeout(this.rewindTimer);
            this.rewindTimer = setTimeout(function () {
                self.rewinding = false;

                var from = self.rewindFrom;
                var to = self.rewindTo;

                if (to > from) self.learn(from, to);
                else {
                    self.acted = false;
                    self.tailDone = false;
                }

                self.last = to;
            }, 1500);
        },

        /** Діагностичний рядок поверх відео */
        debug: function (current) {
            if (!isOn('nfx_sk_debug', false)) {
                remove(document.getElementById('nfx-sk-debug'));
                return;
            }

            var root = toNode(Lampa.Player.render());
            if (!root) return;

            var box = document.getElementById('nfx-sk-debug');
            if (!box) {
                box = el('div', 'nfx-sk-debug');
                box.id = 'nfx-sk-debug';
                root.appendChild(box);
            }

            var m = this.marks || {};
            var tail = this.tailStart();

            box.textContent =
                'id: ' + (this.id || '—') +
                '   час: ' + Math.round(current) + '/' + Math.round(this.duration) +
                '   заставка: ' + (m.intro || '—') +
                '   титри з: ' + (tail ? Math.round(tail) : '—') +
                '   джерело: ' + Clock.source +
                (this.rewinding ? '   [перемотка]' : '');
        },

        checkIntro: function (current) {
            if (this.introDone || this.acted) return;
            if (!isOn('nfx_sk_intro', true)) return;

            var intro = this.marks && this.marks.intro;
            if (!intro) return;
            if (current >= intro - 1) { this.introDone = true; return; }
            if (current < 1) return;

            var self = this;
            Button.show(t('skip_intro'), function () {
                self.introDone = true;
                self.selfSeek = intro;
                try { Lampa.PlayerVideo.to(intro); } catch (e) { /* ignore */ }
            });
        },

        checkTail: function (current) {
            if (this.tailDone) return;
            if (!isOn('nfx_sk_next', true)) return;

            var at = this.tailStart();
            if (!at || current < at) return;

            var series = this.isSeries() && this.canNext();
            if (!series && !isOn('nfx_sk_movie', false)) { this.tailDone = true; return; }

            this.tailDone = true;

            var self = this;

            Button.show(series ? t('next_ep') : t('finish'), function () {
                self.acted = true;
                try {
                    if (series) Lampa.PlayerPlaylist.next();
                    else Lampa.Player.close();
                } catch (e) { /* ignore */ }
            });
        },

        init: function () {
            var self = this;

            Lampa.Player.listener.follow('start', function () {
                self.start();
                Clock.startPolling();
            });

            Lampa.Player.listener.follow('destroy', function () {
                Clock.stopPolling();
                Clock.source = '—';
                Clock.videoAt = 0;
                self.reset();
                Button.destroy();
            });

            Clock.bind();
            Button.controller();
        }
    };

    // =================================================================
    //  CSS — на випадок, якщо в темі немає рідних стилів .player-skip
    // =================================================================

    function injectCSS() {
        remove(document.getElementById(CSS_ID));

        var css = [
            '.nfx-skip.hide { display: none !important; }',
            '.nfx-skip { position: absolute; right: 1.5em; bottom: 1.5em; z-index: 60;' +
            ' padding: 0.8em 1.2em; border-radius: 2em;' +
            ' background: rgba(255,255,255,0.28); color: #fff; font-weight: 700; }',
            '.nfx-skip .player-skip__text { font-size: 1.2em; }',
            '.nfx-skip.focus { background: #fff !important; color: #000 !important; }',
            '.nfx-skip .player-skip__progress { position: absolute; left: 1.7em; right: 1.7em;' +
            ' bottom: -0.6em; height: 0.25em; border-radius: 1em; overflow: hidden;' +
            ' background: rgba(255,255,255,0.35); pointer-events: none; }',
            '.nfx-skip .player-skip__progress-line { height: 100%; background: #fff;' +
            ' transform-origin: left center; transform: scaleX(1); }',
            '.player--panel-visible .nfx-skip { bottom: 9em; }',
            '.nfx-sk-debug { position: absolute; left: 1.5em; top: 1.2em; z-index: 60;' +
            ' padding: 0.4em 0.8em; border-radius: 0.4em; font-size: 0.9em;' +
            ' background: rgba(0,0,0,0.65); color: #6f6; pointer-events: none;' +
            ' font-family: monospace; }'
        ].join('\n');

        var style = document.createElement('style');
        style.id = CSS_ID;
        style.textContent = css;
        document.head.appendChild(style);
    }

    // =================================================================
    //  Налаштування
    // =================================================================

    function initSettings() {
        if (!window.Lampa || !Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            name: t('title'),
            icon: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>'
        });

        var params = [
            { name: 'nfx_sk_next', type: 'trigger', def: true, title: t('s_next') },
            { name: 'nfx_sk_intro', type: 'trigger', def: true, title: t('s_intro') },
            { name: 'nfx_sk_learn', type: 'trigger', def: true, title: t('s_learn') },
            { name: 'nfx_sk_delay', type: 'select', def: '4', title: t('s_delay'),
              values: { '0': '0 c', '2': '2 c', '4': '4 c', '6': '6 c', '8': '8 c' } },
            { name: 'nfx_sk_tail', type: 'select', def: '0', title: t('s_tail'),
              values: { '0': t('off'), '30': '30 c', '45': '45 c', '60': '60 c', '90': '90 c' } },
            { name: 'nfx_sk_movie', type: 'trigger', def: false, title: t('s_movie') },
            { name: 'nfx_sk_debug', type: 'trigger', def: false, title: t('s_debug') }
        ];

        params.forEach(function (p) {
            var conf = { name: p.name, type: p.type, default: p.def };
            if (p.values) conf.values = p.values;

            Lampa.SettingsApi.addParam({
                component: PLUGIN_ID,
                param: conf,
                field: { name: p.title }
            });
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: 'nfx_sk_check', type: 'button' },
            field: { name: t('s_check'), description: t('s_check_d') },
            onChange: function () {
                var c = Clock.can();
                var ok = function (v) { return v ? '+' : '−'; };

                Lampa.Noty.show(
                    t('c_time') + ': ' + ok(c.video_events || c.timeline) +
                    '  ' + t('c_seek') + ': ' + ok(c.seek) +
                    '  ' + t('c_next') + ': ' + ok(c.next) +
                    '  ' + t('c_ui') + ': ' + ok(c.render) +
                    '  ' + t('c_src') + ': ' + Clock.source
                );
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: 'nfx_sk_show', type: 'button' },
            field: { name: t('s_show'), description: t('s_show_d') },
            onChange: function () {
                var all = Memory.all();
                var keys = Object.keys(all);

                if (!keys.length) return Lampa.Noty.show(t('nothing'));

                var lines = keys.slice(0, 8).map(function (k) {
                    var r = all[k];
                    return k + ': ' + t('m_intro') + ' ' + (r.intro || '—') + ', ' + t('m_tail') + ' ' + (r.tail || '—');
                });

                Lampa.Noty.show(keys.length + ' — ' + lines.join(' | '));
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: 'nfx_sk_reset', type: 'button' },
            field: { name: t('s_reset'), description: t('s_reset_d') },
            onChange: function () {
                Memory.clear();
                try { Lampa.Noty.show(t('done')); } catch (e) { /* ignore */ }
            }
        });
    }

    // =================================================================
    //  Старт
    // =================================================================

    function bootstrap() {
        if (window.__nfx_autoskip) return;
        window.__nfx_autoskip = true;

        initSettings();
        injectCSS();
        Engine.init();

        console.log('[NFX Autoskip] v' + VERSION + ' ready');
    }

    function start() {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') bootstrap();
        });
        setTimeout(bootstrap, 800);
    }

    if (window.Lampa && Lampa.Listener) {
        start();
    } else {
        var poll = setInterval(function () {
            if (typeof Lampa !== 'undefined' && Lampa.Listener) {
                clearInterval(poll);
                start();
            }
        }, 200);
    }

})();
