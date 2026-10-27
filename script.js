/**
 * 请假管理系统 —— 五屏结构
 *
 *   工作台(#/workbench) → 掌上校园(#/campus) → 申请记录(#/records)
 *                                            → 申请 → 自定义填写(#/form)
 *                                                    → 生成 → 截图(#/shot/<id>)
 *
 * 返回栈（手机返回手势 / 企业微信返回）：
 *   截图 → 申请记录 → 掌上校园 → 工作台
 *   自定义填写只有一条入口：申请记录底部的「申请」按钮；
 *   生成截图时会把「自定义填写」这条历史替换成「申请记录」，所以从截图返回不会经过填写页。
 */
(function () {
    'use strict';

    /* ============ 常量 ============ */
    var RECS_KEY = 'qj.records.v1';
    var DRAFT_KEY = 'leaveFormData_v2';        // 原有草稿 key，保持不变
    var FIELDS = ['name', 'leaveType', 'startTime', 'endTime', 'reason', 'applyTime', 'counselorName', 'approveTime'];
    var MAX_RECORDS = 100;
    var STATUS_TEXT = '审核通过';               // 所有生成记录一律审核通过

    var PAGES = ['workbench', 'campus', 'records', 'form', 'shot', 'food-home', 'food', 'food-orders', 'food-order-detail', 'food-messages', 'food-chat', 'food-ai', 'food-address', 'food-shop', 'food-item', 'splash', 'leave-loading'];
    var DEPTH = { workbench: 0, campus: 1, records: 2, form: 3, shot: 3,
        'food-home': 1, food: 1, 'food-orders': 2, 'food-order-detail': 3, 'food-messages': 2, 'food-chat': 3, 'food-ai': 1, 'food-address': 2, 'food-shop': 2, 'food-item': 3, splash: 0, 'leave-loading': 2 };
    var FALLBACK = { campus: 'workbench', records: 'campus', form: 'records', shot: 'records', workbench: null,
        food: 'workbench', 'food-orders': 'food', 'food-order-detail': 'food-orders',
        'food-messages': 'food-home', 'food-chat': 'food-messages', 'food-ai': 'food-home',
        'food-home': null, 'food-address': 'food-home',
        'food-shop': 'food-home', 'food-item': 'food-shop', splash: null, 'leave-loading': 'campus' };

    /* ============ 记录存储（localStorage，失败时内存兜底） ============ */
    var store = {
        items: [],
        load: function () {
            try {
                var raw = localStorage.getItem(RECS_KEY);
                var parsed = raw ? JSON.parse(raw) : null;
                if (Array.isArray(parsed)) {
                    this.items = parsed;
                } else if (parsed && Array.isArray(parsed.items)) {
                    this.items = parsed.items;
                } else {
                    this.items = [];
                }
            } catch (e) {
                this.items = [];
            }
        },
        save: function () {
            try {
                localStorage.setItem(RECS_KEY, JSON.stringify({ v: 1, items: this.items.slice(0, MAX_RECORDS) }));
                return true;
            } catch (e) {
                return false;
            }
        },
        add: function (rec) {
            this.items.unshift(rec);
            if (this.items.length > MAX_RECORDS) {
                this.items.length = MAX_RECORDS;
            }
            return this.save();
        },
        get: function (id) {
            for (var i = 0; i < this.items.length; i++) {
                if (this.items[i].id === id) {
                    return this.items[i];
                }
            }
            return null;
        },
        sorted: function () {
            return this.items.slice().sort(function (a, b) {
                return (b.createdAt || 0) - (a.createdAt || 0);
            });
        }
    };

    /* ============ DOM ============ */
    function $(id) {
        return document.getElementById(id);
    }

    var screens = {};
    var currentPage = 'workbench';
    var currentRecordId = null;
    var hideTimer = null;

    /* ============ 页面切换动画（卡片覆盖式） ============
     * 只有「进入的那一屏」在动：
     *   前进：新屏从右侧 100% 滑到 0，旧屏原地不动被盖住
     *   返回：当前屏从 0 滑到右侧 100%，露出下面那张（已在 0 位置）的上一屏
     * 这样屏幕上永远只有「完整的一屏 + 一张正在滑动的屏」，不会露出第三层或页面底色。
     */
    function isFoodScreen(p) {
        return !!p && p.indexOf('food') === 0;
    }

    // 外卖内部跳转：直接硬切，不要过渡动画
    function showFoodScreenInstant(page) {
        var next = screens[page];
        if (!next) {
            return;
        }
        PAGES.forEach(function (p) {
            var el = screens[p];
            if (!el || el === next) {
                return;
            }
            el.style.transition = 'none';
            el.style.display = 'none';
            el.style.transform = 'translateX(0)';
            el.style.zIndex = '1';
            el.style.pointerEvents = 'none';
        });
        next.style.transition = 'none';
        next.style.display = 'flex';
        next.style.transform = 'translateX(0)';
        next.style.zIndex = '1';
        next.style.pointerEvents = 'auto';
        currentPage = page;
        if (page !== 'food-home' && typeof stopHomeWordLoop === 'function') {
            stopHomeWordLoop();
            stopHomeAdLoop();
        }
    }

    // 硬切（无任何过渡动画）
    function showInstant(page) {
        var next = screens[page];
        if (!next) {
            return;
        }
        PAGES.forEach(function (p) {
            var el = screens[p];
            if (!el) {
                return;
            }
            if (el === next) {
                el.style.transition = 'none';
                el.style.display = 'flex';
                el.style.transform = 'translateX(0)';
                el.style.zIndex = '1';
                el.style.pointerEvents = 'auto';
            } else {
                el.style.transition = 'none';
                el.style.display = 'none';
                el.style.transform = 'translateX(0)';
                el.style.zIndex = '1';
                el.style.pointerEvents = 'none';
            }
        });
        currentPage = page;
    }

    function showScreen(page, dir) {
        var next = screens[page];
        var prev = screens[currentPage];
        if (isFoodScreen(page) && isFoodScreen(currentPage) && next && prev && next !== prev) {
            showFoodScreenInstant(page);
            return;
        }
        if (!next) {
            return;
        }
        if (next === prev) {
            next.style.display = 'flex';
            next.style.transform = 'translateX(0)';
            next.style.pointerEvents = 'auto';
            return;
        }

        // 1) 其余屏彻底隐藏
        PAGES.forEach(function (p) {
            var s = screens[p];
            if (!s || s === next || s === prev) {
                return;
            }
            s.style.transition = 'none';
            s.style.display = 'none';
            s.style.transform = 'translateX(0)';
            s.style.zIndex = '1';
            s.style.pointerEvents = 'none';
        });

        next.style.display = 'flex';
        if (prev) {
            prev.style.display = 'flex';
        }

        if (dir === 'back') {
            // 2b) 返回：目标屏静置在 0 垫底，当前屏滑出右侧
            next.style.transition = 'none';
            next.style.transform = 'translateX(0)';
            next.style.zIndex = '2';
            next.style.pointerEvents = 'none';
            void next.offsetWidth;
            next.style.transition = '';

            if (prev) {
                prev.style.zIndex = '3';
                prev.style.pointerEvents = 'none';
                prev.style.transition = 'none';
                prev.style.transform = 'translateX(0)';
                void prev.offsetWidth;
                prev.style.transition = '';
                requestAnimationFrame(function () {
                    prev.style.transform = 'translateX(100%)';
                });
            }
            next.style.pointerEvents = 'auto';
        } else {
            // 2a) 前进：新屏从右侧滑入，旧屏原地不动
            next.style.zIndex = '3';
            next.style.transition = 'none';
            next.style.transform = 'translateX(100%)';
            next.style.pointerEvents = 'none';
            void next.offsetWidth;
            next.style.transition = '';
            requestAnimationFrame(function () {
                next.style.transform = 'translateX(0)';
                next.style.pointerEvents = 'auto';
            });

            if (prev) {
                prev.style.zIndex = '2';
                prev.style.transition = 'none';
                prev.style.transform = 'translateX(0)';
                prev.style.pointerEvents = 'none';
                void prev.offsetWidth;
                prev.style.transition = '';
            }
        }

        currentPage = page;
        // 前进时等「新屏」滑完再把旧屏藏掉；返回时等「旧屏」滑完
        parkPrev(prev, dir === 'back' ? prev : next);
    }

    function parkPrev(prev, animatedEl) {
        if (!prev) {
            return;
        }
        animatedEl = animatedEl || prev;
        clearTimeout(hideTimer);
        var parked = false;
        var onEnd = function (e) {
            if (e.target === animatedEl && e.propertyName === 'transform') {
                park();
            }
        };
        function park() {
            if (parked) {
                return;
            }
            parked = true;
            prev.removeEventListener('transitionend', onEnd);
            clearTimeout(hideTimer);
            if (prev === screens[currentPage]) {
                return;
            }
            prev.style.transition = 'none';
            prev.style.display = 'none';
            prev.style.transform = 'translateX(0)';
            prev.style.zIndex = '1';
            void prev.offsetWidth;
            prev.style.transition = '';
        }
        animatedEl.addEventListener('transitionend', onEnd);
        hideTimer = setTimeout(park, 800);
    }
    /* ============ 路由 ============ */
    function hashOf(page, id) {
        if (page === 'workbench') {
            return '#/workbench';
        }
        if (page === 'campus') {
            return '#/campus';
        }
        if (page === 'records') {
            return '#/records';
        }
        if (page === 'form') {
            return '#/form';
        }
        if (page === 'food-home') {
            return '#/food-home';
        }
        if (page === 'food-address') {
            return '#/food/address';
        }
        if (page === 'food-shop') {
            return '#/food/shop/' + encodeURIComponent(foodState.shopId || '');
        }
        if (page === 'food-item') {
            return '#/food/item/' + encodeURIComponent(foodState.itemId || '') + '/' + encodeURIComponent(foodState.shopId || '');
        }
        if (page === 'food') {
            return '#/food';
        }
        if (page === 'food-orders') {
            return '#/food/orders';
        }
        if (page === 'food-order-detail') {
            return '#/food/order-detail';
        }
        if (page === 'food-messages') {
            return '#/food/messages';
        }
        if (page === 'food-chat') {
            return '#/food/chat/' + encodeURIComponent((foodState.chatRider && foodState.chatRider.name) || '');
        }
        if (page === 'food-ai') {
            return '#/food/ai';
        }
        return '#/shot/' + encodeURIComponent(id || '');
    }

    function parseHash() {
        var h = (location.hash || '').replace(/^#\/?/, '');
        if (h.indexOf('campus') === 0) {
            return { page: 'campus', id: null };
        }
        if (h.indexOf('records') === 0) {
            return { page: 'records', id: null };
        }
        if (h.indexOf('form') === 0) {
            return { page: 'form', id: null };
        }
        if (h.indexOf('shot') === 0) {
            return { page: 'shot', id: decodeURIComponent(h.split('/')[1] || '') };
        }
        if (h === 'food-home' || h === 'food-home/' || h === '') {
            return { page: 'food-home', id: null };
        }
        if (h.indexOf('food') === 0) {
            var rest = h.split('/')[1] || '';
            if (rest === 'address') {
                return { page: 'food-address', id: null };
            }
            if (rest === 'shop') {
                return { page: 'food-shop', id: decodeURIComponent(h.split('/')[2] || '') };
            }
            if (rest === 'item') {
                return { page: 'food-item', id: decodeURIComponent(h.split('/')[2] || ''), shop: decodeURIComponent(h.split('/')[3] || '') };
            }
            if (rest === 'orders') {
                return { page: 'food-orders', id: null };
            }
            if (rest === 'order-detail') {
                return { page: 'food-order-detail', id: null };
            }
            if (rest === 'messages') {
                return { page: 'food-messages', id: null };
            }
            if (rest === 'chat') {
                return { page: 'food-chat', id: decodeURIComponent(h.split('/')[2] || '') };
            }
            if (rest === 'ai') {
                return { page: 'food-ai', id: null };
            }
            return { page: 'food', id: null };
        }
        return { page: 'food-home', id: null };
    }

    // 纯外卖版：只允许外卖相关路由，其他一律回首页
    function guardRoute(route) {
        if (!route || !route.page || String(route.page).indexOf('food') !== 0) {
            return { page: 'food-home', id: null };
        }
        if (route.page === 'splash' || route.page === 'leave-loading') {
            return { page: 'food-home', id: null };
        }
        return route;
    }

    function depthOf(state) {
        if (state && typeof state.d === 'number') {
            return state.d;
        }
        return 0;
    }

    function go(page, id) {
        id = id || null;
        var d = DEPTH[page] !== undefined ? DEPTH[page] : depthOf(history.state) + 1;
        history.pushState({ qj: 1, page: page, id: id, d: d }, '', hashOf(page, id));
        render(page, id, 'forward');
    }

    function replaceWith(page, id) {
        id = id || null;
        var d = DEPTH[page] !== undefined ? DEPTH[page] : depthOf(history.state);
        history.replaceState({ qj: 1, page: page, id: id, d: d }, '', hashOf(page, id));
    }

    function backOr(page) {
        if (depthOf(history.state) > 0) {
            history.back();
        } else {
            var fb = FALLBACK[page] || FALLBACK[currentPage];
            if (fb) {
                go(fb, null);
            }
        }
    }

    function render(page, id, dir) {
        if (page === 'shot') {
            var rec = store.get(id);
            if (!rec) {
                render('records', null, dir === 'back' ? 'forward' : dir);
                replaceWith('records', null);
                return;
            }
            currentRecordId = id;
            renderShot(rec);
        } else if (page === 'records') {
            renderRecords();
        } else if (page === 'campus') {
            renderCampus();
        } else if (page === 'workbench') {
            renderWorkbench();
        } else if (page === 'food-home') {
            renderFoodHome();
        } else if (page === 'food-address') {
            renderFoodAddress();
        } else if (page === 'food-shop') {
            if (id) { foodState.shopId = id; }
            renderFoodShop(foodState.shopId || 'mocksun');
        } else if (page === 'splash') {
            /* 由 startEnterSplash 负责渲染 */
        } else if (page === 'leave-loading') {
            renderLeaveLoading();
        } else if (page === 'food-item') {
            if (id) { foodState.itemId = id; }
            renderFoodItem(foodState.itemId || 'gm', foodState.shopId || '');
        } else if (page === 'food') {
            renderFood();
        } else if (page === 'food-orders') {
            renderFoodOrders();
        } else if (page === 'food-order-detail') {
            renderFoodOrderDetail();
        } else if (page === 'food-messages') {
            renderFoodMessages();
        } else if (page === 'food-chat') {
            if (id) {
                foodState.chatRider = riderByName(id);
            }
            renderFoodChat();
        } else if (page === 'food-ai') {
            renderFoodAi();
        }
        showScreen(page, dir || 'forward');
    }

    /* ============ 工作台 / 掌上校园 渲染 ============ */
    // 单文件版会把 assets 映射进 window.__ASSETS__，这里统一解析（多文件版原样返回）
    function assetUrl(p) {
        if (window.__ASSETS__ && window.__ASSETS__[p]) {
            return window.__ASSETS__[p];
        }
        return p;
    }

    var escapeHtml = function (s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    };

    function gridHtml(items) {
        return items.map(function (it) {
            var cls = 'app-cell' + (it.action ? ' app-cell--tap' : '');
            var data = it.action ? ' data-action="' + it.action + '"' : '';
            var icon = it.icon
                ? '<img class="app-cell__icon" src="' + assetUrl(it.icon) + '" alt="" draggable="false">'
                : '<span class="app-cell__icon app-cell__icon--blank"></span>';
            return '<div class="' + cls + '"' + data + '>' + icon +
                '<div class="app-cell__label">' + escapeHtml(it.label) + '</div></div>';
        }).join('');
    }

    var CAMPUS_SECTIONS = [
        {
            title: '教学科研',
            items: [
                { label: '我的课表', icon: 'assets/icons/campus/course-table.png' },
                { label: '期末报告', icon: 'assets/icons/campus/final-report.png' },
                { label: '移动教务', icon: 'assets/icons/campus/mobile-edu.png' },
                { label: '移动图书馆', icon: 'assets/icons/campus/mobile-lib.png' },
                { label: '实验系统', icon: 'assets/icons/campus/lab.png' },
                { label: '心理系统', icon: 'assets/icons/campus/psychology.png' }
            ]
        },
        {
            title: '办公应用',
            items: [
                { label: '通知公示', icon: 'assets/icons/campus/notice.png' },
                { label: '投票/问卷', icon: 'assets/icons/campus/vote.png' },
                { label: '学生请假申请', icon: 'assets/icons/campus/leave-apply.png', action: 'open-records' },
                { label: '移动迎新', icon: 'assets/icons/campus/welcome.png' },
                { label: '勤工助学', icon: 'assets/icons/campus/work-study.png' },
                { label: '一表通系统', icon: 'assets/icons/campus/form-system.png' }
            ]
        },
        {
            title: '数据服务',
            items: [
                { label: '我的考试', icon: 'assets/icons/campus/exam.png' },
                { label: '我的成绩', icon: 'assets/icons/campus/score.png' },
                { label: '一卡通消费', icon: 'assets/icons/campus/card.png' },
                { label: '我的科研', icon: 'assets/icons/campus/research.png' }
            ]
        },
        {
            title: '校园助手',
            items: [
                { label: '失物招领', icon: 'assets/icons/campus/lost-found.png' },
                { label: '学校班车', icon: 'assets/icons/campus/shuttle.png' },
                { label: '校历', icon: 'assets/icons/campus/calendar.png' },
                { label: '发票助手', icon: 'assets/icons/campus/invoice.png' },
                { label: '维修申请', icon: 'assets/icons/campus/repair.png' }
            ]
        }
    ];

    var WORKBENCH_SECTIONS = [
        {
            title: '效率工具',
            items: [
                { label: '日程', icon: 'assets/icons/workbench/schedule.png' },
                { label: '会议', icon: 'assets/icons/workbench/meeting.png' },
                { label: '微盘', icon: 'assets/icons/workbench/drive.png' },
                { label: '收集表', icon: 'assets/icons/workbench/form.png' }
            ]
        },
        {
            title: '警院微应用',
            layout: 'app-row',
            items: [
                { label: '掌上校园', icon: 'assets/icons/workbench/campus-app.png', action: 'open-campus' }
            ]
        },
        {
            title: '智能办公',
            titleSuffix: 'AI+',
            items: [
                { label: '智能文档', icon: 'assets/icons/workbench/ai-doc.png' },
                { label: '智能表格', icon: 'assets/icons/workbench/ai-sheet.png' },
                { label: '智能总结', icon: 'assets/icons/workbench/ai-summary.png' },
                { label: '智能机器人', icon: 'assets/icons/workbench/ai-bot.png' },
                { label: '记录面聊', icon: 'assets/icons/workbench/record-chat.png' },
                { label: '服务总结', icon: 'assets/icons/workbench/service-summary.png' }
            ]
        },
        {
            title: '',
            layout: 'app-row',
            items: [
                { label: '企业小助手', icon: 'assets/icons/workbench/assistant.png' },
                { label: '手机版', icon: 'assets/icons/workbench/mobile.png' }
            ]
        }
    ];

    // 点「学生请假申请」后的过场：蓝条跑满 + 圈转 2.5 圈，共 1.5s
    var leaveLoadingTimer = null;

    function renderLeaveLoading() {
        var el = $('screen-leave-loading');
        el.innerHTML =
            '<header class="ll-nav">' +
                '<div class="ll-nav__left">' +
                    '<span class="ll-nav__btn">' +
                        '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H5"/><path d="M11 5l-7 7 7 7"/></svg>' +
                    '</span>' +
                    '<span class="ll-nav__btn">' +
                        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
                    '</span>' +
                '</div>' +
                '<h1 class="ll-nav__title">请假管理</h1>' +
                '<span class="ll-nav__btn ll-nav__btn--more">' +
                    '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>' +
                '</span>' +
            '</header>' +
            '<div class="ll-progress"><i></i></div>' +
            '<div class="ll-crumb"><span class="ll-crumb__home">' +
                '<svg viewBox="0 0 24 24" width="15" height="15" fill="#1B5FD9"><path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>' +
                '首页</span></div>' +
            '<div class="ll-body">' +
                '<div class="ll-spinner"><i></i></div>' +
                '<div class="ll-text">加载中...</div>' +
            '</div>';
        el.style.background = '#F2F6F9';
    }

    function runLeaveLoadingThen(next) {
        renderLeaveLoading();
        showInstant('leave-loading');
        clearTimeout(leaveLoadingTimer);
        leaveLoadingTimer = setTimeout(function () {
            history.pushState({ qj: 1, page: next, id: null, d: DEPTH[next] }, '', hashOf(next, null));
            render(next, null, 'none');
            showInstant(next);
        }, 1500);
    }

    var CAMPUS_NAME_KEY = 'qj.campus.name';
    var CAMPUS_NAME_DEFAULT = '芥子一梦';

    function campusName() {
        try {
            var v = localStorage.getItem(CAMPUS_NAME_KEY);
            if (v && v.trim()) {
                return v.trim();
            }
        } catch (e) { /* ignore */ }
        return CAMPUS_NAME_DEFAULT;
    }

    function setCampusName(v) {
        try {
            localStorage.setItem(CAMPUS_NAME_KEY, String(v || '').trim() || CAMPUS_NAME_DEFAULT);
        } catch (e) { /* ignore */ }
    }

    function showNameEditor() {
        var old = $('campus-name-edit');
        if (old) {
            old.parentNode.removeChild(old);
        }
        var box = document.createElement('div');
        box.id = 'campus-name-edit';
        box.className = 'name-edit';
        box.innerHTML =
            '<div class="name-edit__card">' +
                '<div class="name-edit__title">修改姓名</div>' +
                '<input class="name-edit__input" id="campus-name-input" type="text" maxlength="12" value="' + escapeHtml(campusName()) + '">' +
                '<div class="name-edit__acts">' +
                    '<button type="button" class="name-edit__btn" data-name="cancel">取消</button>' +
                    '<button type="button" class="name-edit__btn name-edit__btn--primary" data-name="save">保存</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(box);
        requestAnimationFrame(function () {
            box.classList.add('name-edit--on');
        });
        var input = $('campus-name-input');
        if (input) {
            input.focus();
            input.select();
        }
        var close = function () {
            box.classList.remove('name-edit--on');
            setTimeout(function () {
                if (box.parentNode) {
                    box.parentNode.removeChild(box);
                }
            }, 200);
        };
        box.addEventListener('click', function (e) {
            var act = e.target.closest && e.target.closest('[data-name]');
            if (e.target === box || (act && act.getAttribute('data-name') === 'cancel')) {
                close();
                return;
            }
            if (act && act.getAttribute('data-name') === 'save') {
                setCampusName(input ? input.value : '');
                var el = document.querySelector('#screen-campus .campus-user__name');
                if (el) {
                    el.textContent = campusName();
                }
                close();
            }
        });
    }

    function renderCampus() {
        var host = $('campus-body');
        if (!host || host.getAttribute('data-rendered') === '1') {
            return;
        }
        host.innerHTML = CAMPUS_SECTIONS.map(function (sec) {
            return '<section class="campus-section">' +
                '<h2 class="campus-section__title">' + escapeHtml(sec.title) +
                '<span class="campus-section__chev"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg></span>' +
                '</h2>' +
                '<div class="campus-grid">' + gridHtml(sec.items) + '</div>' +
                '</section>';
        }).join('');
        host.setAttribute('data-rendered', '1');
            syncCampusName();
    }

    // 每次渲染掌上校园时同步姓名
    function syncCampusName() {
        var el = document.querySelector('#screen-campus .campus-user__name');
        if (el) {
            el.textContent = campusName();
        }
    }

    function renderWorkbench() {
        var host = $('workbench-body');
        if (!host || host.getAttribute('data-rendered') === '1') {
            return;
        }
        host.innerHTML = WORKBENCH_SECTIONS.map(function (sec) {
            var head = sec.title
                ? '<div class="wb-card__head"><span class="wb-card__title">' + escapeHtml(sec.title) +
                  '</span>' + (sec.titleSuffix ? '<span class="wb-card__suffix">' + escapeHtml(sec.titleSuffix) + '</span>' : '') + '</div>'
                : '';
            var cls = sec.layout === 'app-row' ? 'wb-grid wb-grid--big' : 'wb-grid';
            return '<section class="wb-card">' + head + '<div class="' + cls + '">' + gridHtml(sec.items) + '</div></section>';
        }).join('');
        host.setAttribute('data-rendered', '1');
    }

    /* ============ 表单页（原有逻辑） ============ */
    var pageForm = null;
    var pageResult = null;
    var generateBtn = null;
    var navBackArrow = null;
    var navBackX = null;

    function saveData() {
        var data = {};
        FIELDS.forEach(function (id) {
            var input = $(id);
            if (input) {
                data[id] = input.value;
            }
        });
        try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
        } catch (e) { /* 忽略配额错误 */ }
    }

    function loadSavedData() {
        var savedData = null;
        try {
            savedData = localStorage.getItem(DRAFT_KEY);
        } catch (e) {
            savedData = null;
        }
        if (!savedData) {
            return;
        }
        try {
            var data = JSON.parse(savedData);
            FIELDS.forEach(function (id) {
                var input = $(id);
                if (input && data[id]) {
                    input.value = data[id];
                }
            });
        } catch (e) { /* 数据损坏则忽略 */ }
    }

    function readForm() {
        var data = {};
        FIELDS.forEach(function (id) {
            var input = $(id);
            data[id] = input ? input.value : '';
        });
        return data;
    }

    function validateForm() {
        return FIELDS.every(function (id) {
            var input = $(id);
            return input && input.value.trim() !== '';
        });
    }

    /* ============ 生成记录页 ============ */
    var filterValue = 'all';
    var recordsScrollTop = 0;

    function formatDateTime(dateTimeStr, includeSeconds) {
        if (!dateTimeStr) {
            return '';
        }
        var date = new Date(dateTimeStr);
        if (isNaN(date.getTime())) {
            return dateTimeStr;
        }
        var y = date.getFullYear();
        var m = String(date.getMonth() + 1).padStart(2, '0');
        var d = String(date.getDate()).padStart(2, '0');
        var h = String(date.getHours()).padStart(2, '0');
        var min = String(date.getMinutes()).padStart(2, '0');
        var formatted = y + '-' + m + '-' + d + ' ' + h + ':' + min;
        if (includeSeconds) {
            formatted += ':00';
        }
        return formatted;
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined && text !== null) {
            node.textContent = text;
        }
        return node;
    }

    function buildCard(rec) {
        var form = rec.form || {};

        var card = el('article', 'rec-card');
        card.setAttribute('data-id', rec.id);
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');

        var head = el('div', 'rec-card__head');
        head.appendChild(el('h3', 'rec-card__title', form.leaveType || '请假'));
        card.appendChild(head);

        card.appendChild(el('div', 'rec-card__divider'));

        var body = el('div', 'rec-card__body');

        var rowStart = el('div', 'rec-row');
        rowStart.appendChild(el('span', 'rec-row__k', '开始时间:'));
        rowStart.appendChild(el('span', 'rec-row__v', formatDateTime(form.startTime, true)));
        body.appendChild(rowStart);

        var rowEnd = el('div', 'rec-row');
        rowEnd.appendChild(el('span', 'rec-row__k', '结束时间:'));
        rowEnd.appendChild(el('span', 'rec-row__v', formatDateTime(form.endTime, true)));
        body.appendChild(rowEnd);

        var rowReason = el('div', 'rec-row rec-row--reason');
        rowReason.appendChild(el('span', 'rec-row__k', '请假理由：'));
        rowReason.appendChild(el('span', 'rec-row__v', form.reason || ''));
        body.appendChild(rowReason);

        body.appendChild(el('div', 'rec-card__status', STATUS_TEXT));
        card.appendChild(body);

        card.addEventListener('click', function () {
            go('shot', rec.id);
        });

        return card;
    }

    function renderRecords() {
        var listEl = $('rec-list');
        var emptyEl = $('rec-empty');
        var all = store.sorted();
        var list = all.filter(function (r) {
            if (filterValue === 'pass') {
                return r.status === 'pass' || !r.status;
            }
            return true;
        });

        listEl.innerHTML = '';
        list.forEach(function (rec) {
            listEl.appendChild(buildCard(rec));
        });

        if (!list.length) {
            emptyEl.hidden = false;
            emptyEl.querySelector('p').textContent = all.length
                ? '没有符合条件的状态记录'
                : '暂无申请记录';
        } else {
            emptyEl.hidden = true;
        }

        var body = $('rec-scroll');
        if (body) {
            body.scrollTop = recordsScrollTop;
        }
    }

    /* ============ 截图页 ============ */
    function renderShot(rec) {
        var data = rec.form || {};

        $('display-leaveType').textContent = data.leaveType || '';
        $('display-reason').textContent = data.reason || '';
        $('display-startTime').textContent = formatDateTime(data.startTime, true);
        $('display-endTime').textContent = formatDateTime(data.endTime, true);
        $('display-applyTime').textContent = formatDateTime(data.applyTime, false);
        $('display-approveTime').textContent = formatDateTime(data.approveTime, false);
        $('display-applyName').textContent = data.name || '';
        $('display-counselorName').textContent = data.counselorName || '';
        var userName = $('display-userName');
        if (userName) {
            userName.textContent = data.name || '';
        }

        var sc = $('scroll-content');
        if (sc) {
            sc.scrollTop = 0;
        }
    }

    /* ============ 生成 ============ */
    function createRecord(data) {
        var rec = {
            id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            createdAt: Date.now(),
            form: data,
            status: 'pass'
        };
        store.add(rec);
        return rec;
    }

    /* ============ 事件绑定 ============ */
    function bindEvents() {
        FIELDS.forEach(function (id) {
            var input = $(id);
            if (input) {
                input.addEventListener('input', saveData);
            }
        });

        generateBtn.addEventListener('click', function () {
            if (!validateForm()) {
                alert('请填写完整必填项！');
                return;
            }
            var data = readForm();
            var rec = createRecord(data);
            // 把「自定义填写」这条历史直接替换成「截图页」：
            //   - 返回时落在「申请记录」（不经过填写页、也不会多出一条重复记录页）
            //   - 填表页只能从「申请」进入，符合「有且仅有点击申请图标能进入」
            history.replaceState(
                { qj: 1, page: 'shot', id: rec.id, d: DEPTH.shot },
                '',
                hashOf('shot', rec.id)
            );
            render('shot', rec.id, 'forward');
        });

        navBackArrow.addEventListener('click', function () {
            backOr('shot');
        });
        navBackX.addEventListener('click', function () {
            go('workbench', null);
        });

        // 申请记录页导航
        $('rec-back').addEventListener('click', function () {
            recordsScrollTop = $('rec-scroll').scrollTop;
            backOr('records');
        });
        $('rec-close').addEventListener('click', function () {
            go('campus', null);
        });
        $('rec-apply').addEventListener('click', function () {
            recordsScrollTop = $('rec-scroll').scrollTop;
            go('form', null);
        });

        // 状态筛选
        var filterBtn = $('rec-filter-btn');
        var filterMenu = $('rec-filter-menu');
        var filterLabel = $('rec-filter-label');

        filterBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var open = filterMenu.hidden;
            filterMenu.hidden = !open;
            filterBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        filterMenu.addEventListener('click', function (e) {
            var li = e.target.closest('li[data-value]');
            if (!li) {
                return;
            }
            filterValue = li.getAttribute('data-value');
            filterLabel.textContent = li.textContent;
            Array.prototype.forEach.call(filterMenu.children, function (item) {
                item.setAttribute('aria-selected', item === li ? 'true' : 'false');
            });
            filterMenu.hidden = true;
            filterBtn.setAttribute('aria-expanded', 'false');
            renderRecords();
        });

        document.addEventListener('click', function () {
            if (!filterMenu.hidden) {
                filterMenu.hidden = true;
                filterBtn.setAttribute('aria-expanded', 'false');
            }
        });

        // 掌上校园：点「学生请假申请」→ 申请记录
        $('screen-campus').addEventListener('click', function (e) {
            var cell = e.target.closest('[data-action]');
            if (!cell) {
                return;
            }
            if (cell.getAttribute('data-action') === 'open-records') {
                runLeaveLoadingThen('records');
            }
        });

        $('campus-back').addEventListener('click', function () {
            backOr('campus');
        });
        $('campus-more').addEventListener('click', function () {
            /* 与原 App 一致：无操作 */
        });

        // 点「个人信息」改名字（按访问者记忆）
        var nameLink = document.querySelector('#screen-campus .campus-user__link');
        if (nameLink) {
            nameLink.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                showNameEditor();
            });
        }

        // 工作台顶部轮播卡：双击（掌上校园图标等可点区域以外）切页
        var bannerAlt = false;
        var lastSlideAt = 0;
        function slideBanner() {
            // 触屏上「两次点击」会同时触发 touchend 双击检测 和 浏览器合成的 dblclick，
            // 这里 400ms 内只允许切换一次，否则会切两次等于没动
            var now = Date.now();
            if (now - lastSlideAt < 400) {
                return;
            }
            lastSlideAt = now;
            // 有双击意图时，取消「首触自动全屏」，避免全屏动画打断手势
            try {
                document.dispatchEvent(new CustomEvent('qj:cancelfs'));
            } catch (e) { /* ignore */ }
            bannerAlt = !bannerAlt;
            var banner = $('wb-banner');
            if (banner) {
                banner.classList.toggle('wb-banner--alt', bannerAlt);
            }
        }
        function isInteractive(target) {
            return !!(target.closest && (target.closest('[data-action]') || target.closest('.wb-tabbar')));
        }
        $('screen-workbench').addEventListener('dblclick', function (e) {
            if (isInteractive(e.target)) {
                return;
            }
            slideBanner();
        });
        // 手机上没有 dblclick，用「两次 tap 间隔 < 320ms」模拟双击
        var lastTapAt = 0;
        var lastTapX = 0;
        var lastTapY = 0;
        $('screen-workbench').addEventListener('touchend', function (e) {
            if (isInteractive(e.target) || !e.changedTouches || !e.changedTouches.length) {
                return;
            }
            var t = e.changedTouches[0];
            var now = Date.now();
            if (now - lastTapAt < 320 && Math.abs(t.clientX - lastTapX) < 30 && Math.abs(t.clientY - lastTapY) < 30) {
                slideBanner();
                lastTapAt = 0;
            } else {
                lastTapAt = now;
                lastTapX = t.clientX;
                lastTapY = t.clientY;
            }
        });

        // 工作台：点「掌上校园」→ 掌上校园
        $('screen-workbench').addEventListener('click', function (e) {
            var cell = e.target.closest('[data-action]');
            if (!cell) {
                return;
            }
            if (cell.getAttribute('data-action') === 'open-campus') {
                go('campus', null);
            }
            if (cell.getAttribute('data-action') === 'open-food') {
                go('food', null);
            }
        });

        window.addEventListener('popstate', function (e) {
            var st = e.state;
            if (!st || !st.page) {
                var route = guardRoute(parseHash());
                if (route.shop) { foodState.shopId = route.shop; }
                render(route.page, route.id, 'back');
                return;
            }
            render(st.page, st.id, 'back');
        });
    }


    /* ---------- 手机端：首次触摸自动进入沉浸全屏（浏览器标签页里去掉地址栏） ---------- */
    (function __fsBoot() {
        try {
            var isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
            var isWeCom = /wxwork/i.test(navigator.userAgent);
            var isMobile = window.innerWidth <= 600;
            if (isStandalone || isWeCom || !isMobile) {
                return;
            }
            var done = false;
            var fsTimer = null;
            function isFormTarget(t) {
                if (!t || !t.tagName) {
                    return false;
                }
                var tag = t.tagName.toLowerCase();
                if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') {
                    return true;
                }
                return !!(t.closest && t.closest('input,textarea,select,button'));
            }
            function requestFs(ev) {
                if (done) {
                    return;
                }
                // 点在输入框/按钮上时不抢手势：否则键盘可能被全屏动画打断
                if (ev && isFormTarget(ev.target)) {
                    return;
                }
                done = true;
                document.removeEventListener('touchend', requestFs, true);
                document.removeEventListener('pointerup', requestFs, true);
                if (fsTimer) {
                    clearTimeout(fsTimer);
                    fsTimer = null;
                }
                var el = document.documentElement;
                var fn = el.requestFullscreen || el.webkitRequestFullscreen;
                if (!fn) {
                    return;
                }
                try {
                    var p = fn.call(el);
                    if (p && p.catch) {
                        p.catch(function () {});
                    }
                } catch (e) { /* 某些 WebView 不支持，忽略 */ }
            }
            function scheduleFs(ev) {
                if (done || fsTimer) {
                    return;
                }
                if (ev && isFormTarget(ev.target)) {
                    return;
                }
                fsTimer = setTimeout(function () {
                    fsTimer = null;
                    requestFs();
                }, 420);
            }
            document.addEventListener('touchend', scheduleFs, true);
            document.addEventListener('pointerup', scheduleFs, true);
        } catch (e) { /* 忽略 */ }
    })();

/* ============================================================
     * 外卖模块（工作台底部「我」→ 外卖「我的」→ 订单/消息/AI点餐）
     * 复刻自 6 张参考图，数据全部本地生成，不请求网络
     * ============================================================ */
    var FOOD_KEY_ETA = 'qj.food.eta';
    var FOOD_KEY_ADDR = 'qj.food.addr';
    var FOOD_KEY_PASS = 'qj.food.pass';
    var FOOD_PASS_TTL = 24 * 60 * 60 * 1000;

    // 网站默认展示的价格（两个数字拼起来就是默认密码 4558）
    function defaultFoodPass() {
        return { code: '7891', price: 78, origin: 91, expireAt: 0, isDefault: true };
    }

    function loadFoodPass() {
        try {
            var o = JSON.parse(localStorage.getItem(FOOD_KEY_PASS) || 'null');
            if (o && o.code && o.price && o.origin) {
                return o;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function saveFoodPass(o) {
        try {
            localStorage.setItem(FOOD_KEY_PASS, JSON.stringify(o));
        } catch (e) { /* ignore */ }
    }

    // 仍有效的密码（24h 内）
    function validFoodPass() {
        var o = loadFoodPass();
        if (o && o.expireAt && Date.now() < o.expireAt) {
            return o;
        }
        return null;
    }

    // 当前展示 / 校验用的密码
    function activeFoodPass() {
        return validFoodPass() || defaultFoodPass();
    }

    // 随机生成：标价 < 原价，各两位，拼成 4 位密码
    function randomFoodPass() {
        var a;
        var b;
        var guard = 0;
        do {
            a = 10 + Math.floor(Math.random() * 90);
            b = 10 + Math.floor(Math.random() * 90);
            guard++;
        } while (
            (b <= a || String(a) === String(b) || (String(a) + String(b)) === '7891') && guard < 200
        );
        return {
            code: String(a) + String(b),
            price: a,
            origin: b,
            expireAt: Date.now() + FOOD_PASS_TTL
        };
    }

    // 进入该商品详情页时调用：没有有效密码就生成一组
    function activateFoodPass() {
        if (!validFoodPass()) {
            var p = randomFoodPass();
            saveFoodPass(p);
            return p;
        }
        return validFoodPass();
    }
    var FOOD_ADDR_DEFAULT = {
        name: '晴',
        phone: '11451419191',
        addr: '广东警官学院嘉禾校区后门'
    };
    var foodAddr = {
        name: FOOD_ADDR_DEFAULT.name,
        phone: FOOD_ADDR_DEFAULT.phone,
        addr: FOOD_ADDR_DEFAULT.addr
    };

    function loadFoodAddr() {
        try {
            var raw = localStorage.getItem(FOOD_KEY_ADDR);
            var o = raw ? JSON.parse(raw) : null;
            if (o && typeof o === 'object') {
                foodAddr.name = String(o.name || FOOD_ADDR_DEFAULT.name);
                foodAddr.phone = String(o.phone || FOOD_ADDR_DEFAULT.phone);
                foodAddr.addr = String(o.addr || FOOD_ADDR_DEFAULT.addr);
            }
        } catch (e) { /* ignore */ }
    }

    function saveFoodAddr() {
        try {
            localStorage.setItem(FOOD_KEY_ADDR, JSON.stringify(foodAddr));
        } catch (e) { /* ignore */ }
    }
    var FOOD_KEY_TAB = 'qj.food.tab';

    var foodState = {
        eta: null,          // 'HH:mm'；null = 跟随当前时间
        chatRider: null,
        shopId: null,
        itemId: null,
        ordersTab: 'waiting' // waiting | all | review | refund
    };

    function pad2(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    // 手机号掩码：前 3 + **** + 后 4（如 11451419191 → 114****9191）
    function maskPhone(p) {
        var v = String(p || '').replace(/\s+/g, '');
        if (v.length < 7) {
            return v || '114****9191';
        }
        return v.slice(0, 3) + '****' + v.slice(-4);
    }

    function fmtClock(d) {
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    function loadFoodEta() {
        try {
            var v = localStorage.getItem(FOOD_KEY_ETA);
            if (v && /^\d{1,2}:\d{2}$/.test(v)) {
                return v;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function saveFoodEta(v) {
        try {
            if (v) {
                localStorage.setItem(FOOD_KEY_ETA, v);
            } else {
                localStorage.removeItem(FOOD_KEY_ETA);
            }
        } catch (e) { /* ignore */ }
    }

    function etaLabel() {
        return foodState.eta || fmtClock(new Date());
    }

    /* ---------- 数据：一个「待收货」订单（益恒通医疗器械·东平店） ---------- */
    var FOOD_ORDER = {
        id: 'yh20261025',
        store: '益恒通医疗器械(东平店)',
        tagOut: '超出配送范围',
        status: '待收货',
        items: [
            {
                name: '[海氏海诺]脱脂纱布绷带*2卷/袋医用非无菌纱布绷带伤口包扎外科6cm*600cm*2卷/袋',
                qty: 1,
                price: 5.15,
                origin: 7.8,
                tag: '7天无理由退换',
                img: 'assets/food/food-gauze.jpg'
            },
            {
                name: '[云南白药泰邦]创口贴(轻巧型)70*20mm*20片/盒伤口贴擦伤',
                qty: 1,
                price: 8.14,
                origin: 15.8,
                tag: '不支持7天无理由退换',
                img: 'assets/food/food-bandage.jpg'
            }
        ],
        packing: 0.5,
        delivery: 0,
        total: 13.79,
        saved: 10.31
    };

    var FOOD_RIDERS = [
        { id: 'pangming', name: '庞铭', avatar: 'assets/food/avatar-rider-pangming.png' },
        { id: 'lixiaoling', name: '李小玲', avatar: 'assets/food/avatar-rider-lixiaoling.png' },
        { id: 'lishifeng', name: '李士凤', avatar: 'assets/food/avatar-rider-lishifeng.png' }
    ];

    function riderByName(name) {
        for (var i = 0; i < FOOD_RIDERS.length; i++) {
            if (FOOD_RIDERS[i].name === name) {
                return FOOD_RIDERS[i];
            }
        }
        return FOOD_RIDERS[0];
    }

    /* ---------- 通用小工具 ---------- */
    function foodImg(src, cls, alt) {
        return '<img class="' + (cls || '') + '" src="' + assetUrl(src) + '" alt="' + (alt || '') + '" draggable="false">';
    }

    // 我的页信息流卡片：图片层（距离/角标叠加）+ 文字层
    function feedCard(img, name, desc, price, distance, shop, badge, shipTag) {
        return '<div class="food-feed__item">' +
            '<div class="food-feed__pic">' +
                foodImg('assets/food/' + img + '.jpg', 'food-feed__img') +

            '</div>' +
            '<div class="food-feed__body">' +
                '<div class="food-feed__name">' + name + '</div>' +
                '<div class="food-feed__meta">' + desc + '</div>' +
                (price ? '<div class="food-feed__price"><b>¥' + price + '</b><em>预估到手</em></div>' : '') +
                (shop ? '<div class="food-feed__ship"><span>' + shop + '</span>' + (shipTag ? '<b>' + shipTag + '</b>' : '') + '</div>' : '') +
            '</div></div>';
    }

    function foodTabbar(active) {
        var tabs = [
            { key: 'home', label: '推荐', icon: 'assets/food/tab-home-a.png', action: 'food-home' },
            { key: 'msg', label: '消息', icon: 'assets/food/tab-msg-a.png', action: 'food-messages' },
            { key: 'ai', label: 'AI点外卖', icon: 'assets/food/tab-ai.png', action: 'food-ai', ai: true },
            { key: 'cart', label: '购物车', icon: 'assets/food/tab-cart-a.png' },
            { key: 'me', label: '我的', icon: 'assets/food/tab-me-a.png', action: 'food' }
        ];
        return '<nav class="food-tabbar">' + tabs.map(function (t) {
            var on = t.key === active ? ' food-tab--active' : '';
            var act = t.action ? ' data-food-go="' + t.action + '"' : '';
            var url = assetUrl(t.icon);
            // AI 图标保留原本的彩色；其余用 mask 让图标跟着当前 tab 变橙
            var ico = t.ai
                ? foodImg(t.icon, 'food-tab__icon')
                : '<i class="food-tab__ico" style="-webkit-mask-image:url(' + url + ');mask-image:url(' + url + ')"></i>';
            return '<button type="button" class="food-tab' + on + (t.ai ? ' food-tab--ai' : '') + '"' + act + '>' +
                ico +
                '<span class="food-tab__label">' + t.label + '</span></button>';
        }).join('') + '</nav>';
    }

    function foodNav(title, action) {
        return '<header class="food-nav">' +
            '<button type="button" class="food-nav__back" ' + (action || 'data-food-back') + ' aria-label="返回">' +
            '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H4"/><path d="M10 5l-7 7 7 7"/></svg>' +
            '</button>' +
            '<h1 class="food-nav__title">' + title + '</h1>' +
            '<span class="food-nav__right">' + (arguments.length > 2 ? arguments[2] : '') + '</span>' +
            '</header>';
    }

    /* ---------- 1) 外卖「我的」（长页面） ---------- */
    function renderFood() {
        var el = $('screen-food');
        var quick = [
            { icon: 'assets/food/icon-card-crown.png', label: '超级吃货卡', sub: '购卡即享优惠' },
            { icon: 'assets/food/icon-bean.png', label: '吃货豆', sub: '0', strong: true },
            { icon: 'assets/food/icon-coupon.png', label: '红包卡券', sub: '查看红包' }
        ];
        var orderIcons = [
            { icon: 'assets/food/icon-order-all.png', label: '全部', act: 'food-orders' },
            { icon: 'assets/food/icon-order-wait.png', label: '待收货/使用', act: 'food-orders' },
            { icon: 'assets/food/icon-order-review.png', label: '待评价' },
            { icon: 'assets/food/icon-order-refund.png', label: '退款' }
        ];
        var wallet = [
            { num: '22', unit: '万', label: '借钱', badge: '未读1' },
            { num: '50', unit: '元起', label: '礼品卡' },
            { num: '420', unit: '元', label: '外卖红包', dot: true },
            { num: '15', unit: '元', label: '最高支付权益' }
        ];
        var more = [
            { icon: 'assets/food/icon-addr.png', label: '我的地址', act: 'food-address' },
            { icon: 'assets/food/icon-service.png', label: '我的客服' },
            { icon: 'assets/food/icon-invoice.png', label: '开发票' },
            { icon: 'assets/food/icon-rebate.png', label: '下单返' }
        ];
        var interact = [
            { icon: 'assets/food/icon-cash.png', label: '天天赚现金' },
            { icon: 'assets/food/icon-treasure.png', label: '天天夺宝' },
            { icon: 'assets/food/icon-lottery.png', label: '天天抽奖' },
            { icon: 'assets/food/icon-fruit.png', label: '免费领水果' }
        ];

        el.innerHTML =
            '<div class="food-scroll food-scroll--me">' +
                '<div class="food-me-head">' +
                    '<div class="food-me-user">' +
                        '<span class="food-me-avatar"></span>' +
                        '<span class="food-me-phone">' + maskPhone(foodAddr.phone) + '</span>' +
                    '</div>' +
                    '<button type="button" class="food-me-gear" aria-label="设置">' +
                        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>' +
                    '</button>' +
                '</div>' +
                '<div class="food-vip">' + foodImg('assets/food/banner-vip.jpg', 'food-vip__img') + '</div>' +
                '<div class="food-card food-quick">' + quick.map(function (q) {
                    return '<div class="food-quick__item">' + foodImg(q.icon, 'food-quick__icon') +
                        '<span class="food-quick__label">' + q.label + '</span>' +
                        '<span class="food-quick__sub' + (q.strong ? ' food-quick__sub--strong' : '') + '">' + q.sub + '</span></div>';
                }).join('') + '</div>' +
                '<div class="food-card food-myorders">' +
                    '<div class="food-card__hd"><h3 class="food-card__title">我的订单</h3>' +
                        '<span class="food-card__more">全部订单<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></span></div>' +
                    '<div class="food-orders-icons">' + orderIcons.map(function (o) {
                        return '<div class="food-orders-icons__item"' + (o.act ? ' data-food-go="' + o.act + '"' : '') + '>' +
                            foodImg(o.icon, 'food-orders-icons__icon') +
                            '<span class="food-orders-icons__label">' + o.label + '</span></div>';
                    }).join('') + '</div>' +
                '</div>' +
                '<div class="food-card food-delivering" data-food-go="food-order-detail">' +
                    foodImg('assets/food/logo-yihengtong.png', 'food-delivering__logo') +
                    '<div class="food-delivering__main">' +
                        '<div class="food-delivering__row"><span class="food-delivering__title">商家正在送货</span>' +
                            '<span class="food-delivering__count">共2件</span></div>' +
                        '<div class="food-delivering__eta">预计' + etaLabel() + '送达</div>' +
                    '</div>' +
                '</div>' +
                '<div class="food-card food-wallet">' +
                    '<div class="food-card__hd"><h3 class="food-card__title">我的钱包</h3>' +
                        '<span class="food-card__more">查看全部<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></span></div>' +
                    '<div class="food-wallet__row">' + wallet.map(function (w) {
                        return '<div class="food-wallet__item">' +
                            (w.badge ? '<span class="food-wallet__badge">' + w.badge + '</span>' : '') +
                            '<span class="food-wallet__num">' + w.num + '<i>' + w.unit + '</i>' + (w.dot ? '<b class="food-wallet__dot"></b>' : '') + '</span>' +
                            '<span class="food-wallet__label">' + w.label + '</span></div>';
                    }).join('') + '</div>' +
                    '<div class="food-wallet__dots"><i class="on"></i><i></i><i></i></div>' +
                '</div>' +
                '<div class="food-two-col">' +
                    '<div class="food-card food-fav">' +
                        '<div class="food-card__hd"><h3 class="food-card__title">我的关注</h3>' +
                            '<span class="food-card__more"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></span></div>' +
                        '<div class="food-fav__body">' + foodImg('assets/food/icon-fav.png', 'food-fav__icon') +
                            '<div class="food-fav__txt"><span class="food-fav__t1">暂无关注</span><span class="food-fav__t2">添加店铺，找店不迷路</span></div></div>' +
                    '</div>' +
                    '<div class="food-card food-shop">' +
                        '<div class="food-card__hd"><h3 class="food-card__title">常点的店</h3>' +
                            '<span class="food-card__more"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></span></div>' +
                        '<div class="food-shop__body">' + foodImg('assets/food/logo-sushi.png', 'food-shop__logo') +
                            '<div class="food-shop__txt"><span class="food-shop__name">小二寿司·鳗鱼饭</span>' +
                            '<span class="food-shop__sub">(广州嘉禾望岗店)</span><span class="food-shop__sub">点过4次</span></div></div>' +
                    '</div>' +
                '</div>' +
                '<div class="food-card food-more">' +
                    '<div class="food-card__hd"><h3 class="food-card__title">更多功能</h3></div>' +
                    '<div class="food-more__row">' + more.map(function (m) {
                        return '<div class="food-more__item"' + (m.act ? ' data-food-go="' + m.act + '"' : '') + '>' +
                            foodImg(m.icon, 'food-more__icon') +
                            '<span class="food-more__label">' + m.label + '</span></div>';
                    }).join('') + '</div>' +
                    '<div class="food-wallet__dots"><i class="on"></i><i></i><i></i><i></i><i></i></div>' +
                '</div>' +
                '<div class="food-card food-interact">' +
                    '<div class="food-card__hd"><h3 class="food-card__title">互动中心</h3></div>' +
                    '<div class="food-more__row">' + interact.map(function (m) {
                        return '<div class="food-more__item">' + foodImg(m.icon, 'food-more__icon') +
                            '<span class="food-more__label">' + m.label + '</span></div>';
                    }).join('') + '</div>' +
                '</div>' +
                '<div class="food-feed">' +
                    '<div class="food-feed__col">' +
                        '<div class="food-card food-taste">' +
                            '<div class="food-card__hd"><h3 class="food-card__title">口味档案</h3></div>' +
                            '<div class="food-taste__row">' + foodImg('assets/food/icon-bookmark.png', 'food-taste__icon') +
                                '<span class="food-taste__link">编辑偏好后更懂你</span>' +
                                '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#7C8794" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></div>' +
                            '<div class="food-taste__stats">' +
                                '<div><b>298</b><i>次</i><span>累计点餐</span></div>' +
                                '<div><b>微辣</b><span>辣度偏好</span></div>' +
                            '</div>' +
                        '</div>' + feedCard('feed-garlic', '蒜苔炒肉（不含饭）', '口感丰富，独特的风味', '20', '25分钟 4.9km', '嘎嘎好吃东北老饭盒', '', '') +
                        feedCard('feed-chickenpot', '【新客专享】星厨葱油鸡...', '掌柜说：保温包装', '', '36分钟 4.4km', '', '新客专享', '') +
                    '</div>' +
                    '<div class="food-feed__col">' +
                        feedCard('feed-salad', '豪华双拼·炙烤牛鸡健康餐...', '顾客常点的热门选择', '28.9', '21分钟 2.6km', '蔬三时·轻食·健康', '', '免配送费') +
                        feedCard('feed-yogurt', '冰蓝蔓越莓酸奶', '好评率100% | 本店热销TOP2', '15.9', '29分钟 5km', '茶瀑布', '', '') +
                        feedCard('feed-friedchicken', '汉森炸鸡 双人桶', '现点现炸 外酥里嫩', '39.9', '32分钟 5.8km', '汉森炸鸡', '', '') +
                    '</div>' +
                '</div>' +
                '<div class="food-me-tail"></div>' +
            '</div>' +
            foodTabbar('me');
        el.style.background = '#F5F6F7';
    }

    /* ---------- 2) 订单列表（待收货/使用） ---------- */
    function renderFoodOrders() {
        var el = $('screen-food-orders');
        var tabs = [
            { key: 'all', label: '全部订单' },
            { key: 'waiting', label: '待收货/使用' },
            { key: 'review', label: '待评价', badge: '9' },
            { key: 'refund', label: '退款' }
        ];
        var listHtml;
        if (foodState.ordersTab === 'waiting') {
            var o = FOOD_ORDER;
            listHtml = '<div class="food-order-card" data-food-go="food-order-detail">' +
                '<div class="food-order-card__hd">' +
                    foodImg('assets/food/logo-yihengtong.png', 'food-order-card__logo') +
                    '<span class="food-order-card__store">' + o.store + '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#9AA4B0" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></span>' +
                    '<span class="food-order-card__eta">预计' + etaLabel() + '送达</span>' +
                '</div>' +
                '<div class="food-order-card__tags"><span class="food-chip food-chip--red">38减1</span>' +
                    '<span class="food-chip">支持自取</span><span class="food-chip">食无忧</span></div>' +
                '<div class="food-order-card__items">' + o.items.map(function (it) {
                    return '<div class="food-order-card__thumb">' + foodImg(it.img, 'food-order-card__img') + '</div>';
                }).join('') +
                '<div class="food-order-card__price"><b>¥' + o.total.toFixed(2) + '</b><span>共' + o.items.length + '件</span></div></div>' +
                '<div class="food-order-card__acts"><button type="button" class="food-btn food-btn--ghost">开发票</button>' +
                    '<button type="button" class="food-btn food-btn--ghost"><i class="food-bean"></i>领10豆</button></div>' +
                '</div>' +
                '<div class="food-orders__footer">仅展示最近三个月订单</div>';
        } else {
            listHtml = '<div class="food-orders__empty">暂无订单</div>';
        }
        el.innerHTML =
            '<header class="food-nav food-nav--search">' +
                '<button type="button" class="food-nav__back" data-food-go="food" aria-label="返回">' +
                    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H4"/><path d="M10 5l-7 7 7 7"/></svg>' +
                '</button>' +
                '<div class="food-search">' +
                    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#9AA1AE" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>' +
                    '<span>搜订单</span>' +
                '</div>' +
                '<div class="food-nav__icons">' +
                    '<span class="food-nav__icon-item">' + foodImg('assets/food/icon-star-mini.png', 'food-nav__ico') + '<span>常点</span></span>' +
                    '<span class="food-nav__icon-item">' + foodImg('assets/food/icon-toolbox.png', 'food-nav__ico') + '<span>工具箱</span></span>' +
                '</div>' +
            '</header>' +
            '<div class="food-scroll food-scroll--orders">' +
                '<div class="food-ordertabs">' + tabs.map(function (t) {
                    var on = t.key === foodState.ordersTab ? ' food-ordertabs__item--on' : '';
                    return '<button type="button" class="food-ordertabs__item' + on + '" data-food-tab="' + t.key + '">' +
                        t.label + (t.badge ? '<i class="food-ordertabs__badge">' + t.badge + '</i>' : '') + '</button>';
                }).join('') + '</div>' +
                listHtml +
            '</div>';
        el.style.background = '#F5F6F7';
    }

    /* ---------- 3) 订单详情（已送达） ---------- */
    function renderFoodOrderDetail() {
        var el = $('screen-food-order-detail');
        var o = FOOD_ORDER;
        el.innerHTML =
            '<div class="food-scroll food-scroll--detail">' +
                '<header class="food-detail-nav">' +
                    '<button type="button" class="food-nav__back" data-food-back aria-label="返回">' +
                    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H4"/><path d="M10 5l-7 7 7 7"/></svg></button>' +
                    '<span class="food-detail-nav__right">' + foodImg('assets/food/icon-cs.png', 'food-detail-nav__cs') + '<span>客服</span></span>' +
                '</header>' +
                '<div class="food-detail-status">' +
                    '<h2 class="food-detail-status__title">预计' + etaLabel() + '送达<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></h2>' +
                    '<p class="food-detail-status__sub">骑手正在为你配送，请保持电话畅通</p>' +
                '</div>' +
                '<div class="food-detail-addr">' +
                    '<div class="food-detail-addr__row"><span class="food-detail-addr__k">送至</span>' +
                        '<span class="food-detail-addr__v">' + escapeHtml(foodAddr.addr) + '</span></div>' +
                    '<div class="food-detail-addr__row"><span class="food-detail-addr__k"></span><span class="food-detail-addr__v">' + escapeHtml(foodAddr.name) + ' ' + escapeHtml(foodAddr.phone) + '</span></div>' +
                '</div>' +
                '<div class="food-detail-acts">' +
                    '<button type="button" class="food-detail-act"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#F1782B" stroke-width="1.9" stroke-linecap="round"><rect x="4" y="3.5" width="12" height="17" rx="2"/><path d="M8 8h4M8 12h4M17 15h5M19.5 12.5v5"/></svg><span>再买一单</span></button>' +
                    '<button type="button" class="food-detail-act"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#1A1E24" stroke-width="1.9" stroke-linecap="round"><path d="M4 5.5h16v11H9l-5 4z"/></svg><span>联系商家</span></button>' +
                '</div>' +
                '<div class="food-detail-other"><span class="food-detail-other__l"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#1A1E24" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/></svg>其他服务</span>' +
                    '<span class="food-detail-other__r">蜂鸟准时达，号码保护<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#C2C8D0" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></span></div>' +
                '<div class="food-detail-banner">' + foodImg('assets/food/banner-tmall.jpg', 'food-detail-banner__img') + '</div>' +
                '<div class="food-detail-shop"><span class="food-detail-shop__name">' + o.store + '</span>' +
                    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#9AA4B0" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></div>' +
                o.items.map(function (it) {
                    return '<div class="food-detail-item">' + foodImg(it.img, 'food-detail-item__img') +
                        '<div class="food-detail-item__mid">' +
                            '<div class="food-detail-item__name">' + it.name + '</div>' +
                            '<span class="food-detail-item__tag">' + it.tag + '</span>' +
                        '</div>' +
                        '<div class="food-detail-item__right">' +
                            '<div class="food-detail-item__price">实付<b>¥' + it.price.toFixed(2) + '</b><del>¥' + it.origin.toFixed(1) + '</del></div>' +
                            '<span class="food-detail-item__add">加入购物车</span>' +
                        '</div>' +
                        '</div>' +
                        '<div class="food-detail-item__qty">x' + it.qty + '</div>';
                }).join('') +
                '<div class="food-detail-fee"><span>打包费<i class="food-q">?</i></span><b>¥' + o.packing.toFixed(1) + '</b></div>' +
                '<div class="food-detail-fee"><span>配送费<i class="food-q">?</i></span><b>¥' + o.delivery.toFixed(1) + '</b></div>' +
                '<div class="food-detail-total"><span class="food-detail-total__l">价格明细<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#9AA4B0" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></span>' +
                    '<span class="food-detail-total__r"><em>总优惠 ¥' + o.saved.toFixed(2) + '</em>实付款 <b>¥' + o.total.toFixed(2) + '</b></span></div>' +
                '<div class="food-detail-tail"></div>' +
            '</div>';
        el.style.background = '#FFFFFF';
    }

    /* ---------- 4) 消息中心 ---------- */
    function renderFoodMessages() {
        var el = $('screen-food-messages');
        var platform = [
            { icon: 'assets/food/icon-hot.png', title: '复购高 人气旺', sub: '跟着吃 准没错', bubble: '好吃又省心', badge: '爆火' },
            { icon: 'assets/food/icon-rider-pickup.png', title: '骑手已取餐', sub: '您的订单已从姆斯汉堡(嘉禾警官学院店)取...', time: '17:32', dot: true },
            { icon: 'assets/food/icon-shield.png', title: '食无忧保障已生效', sub: '点击查看保障详情>>', time: '17:16', dot: true }
        ];
        var chats = [
            { avatar: 'assets/food/avatar-shop-ms.png', name: '姆斯汉堡(嘉禾警官学院店)福利粉丝群6群', sub: '商家: 堡堡们🍔 姆斯汉堡整天一直营业哦...', time: '16:05', badge: '99+' },
            { avatar: 'assets/food/avatar-rider-pangming.png', name: '骑手庞铭', sub: '骑手: 您的订单已经送达校园送站点，15-20...', time: '10-22', dot: true, rider: '庞铭' },
            { avatar: 'assets/food/avatar-rider-pangming.png', name: '骑手庞铭', sub: '骑手: 您的订单已经送达校园送站点，15-20...', time: '10-21', dot: true, rider: '庞铭' },
            { avatar: 'assets/food/avatar-rider-lixiaoling.png', name: '骑士李小玲', sub: '骑手: [图片]', time: '10-21', dot: true, rider: '李小玲' },
            { avatar: 'assets/food/avatar-rider-lishifeng.png', name: '骑手李士凤', sub: '骑手: 您的订单已经送达校园送站点，15-20...', time: '10-20', dot: true, rider: '李士凤' },
            { avatar: 'assets/food/avatar-rider-lishifeng.png', name: '骑手李士凤', sub: '骑手: 您的订单已经送达校园送站点，15-20...', time: '10-20', dot: true, rider: '李士凤' }
        ];
        el.innerHTML =
            '<header class="food-msg-nav">' +
                '<button type="button" class="food-nav__back" data-food-go="food" aria-label="返回">' +
                '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H4"/><path d="M10 5l-7 7 7 7"/></svg></button>' +
                '<h1 class="food-msg-nav__title">消息中心</h1>' +
                '<div class="food-msg-nav__right">' +
                    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10h12l4-4v14l-4-4H4z"/></svg>' +
                    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9 2 2 0 1 1-2.8 2.8 1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2 2 2 0 1 1-2.8-2.8A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9 2 2 0 1 1 2.8-2.8A1.7 1.7 0 0 0 9.9 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2 2 2 0 1 1 2.8 2.8A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z"/></svg>' +
                '</div>' +
            '</header>' +
            '<div class="food-scroll food-scroll--msg">' +
                '<div class="food-msg-sec"><div class="food-msg-sec__hd"><span>平台消息</span><span class="food-msg-sec__more">查看全部<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#9AA4B0" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></span></div>' +
                platform.map(function (p, pi) {
                    return '<div class="food-msg-plat' + (pi === 0 ? ' food-msg-plat--hl' : '') + '">' +
                        '<div class="food-msg-plat__ico">' + foodImg(p.icon, 'food-msg-plat__img') +
                            (p.badge ? '<span class="food-msg-plat__badge">' + p.badge + '</span>' : '') + '</div>' +
                        '<div class="food-msg-plat__body"><div class="food-msg-plat__title">' + p.title +
                            (p.bubble ? '<span class="food-msg-plat__bubble">' + p.bubble + '</span>' : '') + '</div>' +
                        '<div class="food-msg-plat__sub">' + p.sub + '</div></div>' +
                        (p.time ? '<span class="food-msg-plat__time">' + p.time + '</span>' : '') +
                        (p.dot ? '<span class="food-msg-dot"></span>' : '<span class="food-msg-close">✕</span>') +
                        '</div>';
                }).join('') + '</div>' +
                '<div class="food-msg-sec"><div class="food-msg-sec__hd"><span>全部消息</span></div>' +
                chats.map(function (c) {
                    return '<div class="food-msg-row"' + (c.rider ? ' data-food-chat="' + c.rider + '"' : '') + '>' +
                        '<span class="food-msg-row__avatar">' + foodImg(c.avatar, 'food-msg-row__img') +
                            (c.badge ? '<i class="food-msg-row__badge">' + c.badge + '</i>' : '') + '</span>' +
                        '<div class="food-msg-row__body"><span class="food-msg-row__name">' + c.name + '</span>' +
                        '<span class="food-msg-row__sub">' + c.sub + '</span></div>' +
                        '<span class="food-msg-row__time">' + c.time + '</span>' +
                        (c.dot ? '<span class="food-msg-dot"></span>' : '') +
                        '</div>';
                }).join('') + '</div>' +
                '<div class="food-msg-tail"></div>' +
            '</div>' + foodTabbar('msg');
        el.style.background = '#F5F6F7';
    }

    /* ---------- 5) 骑手聊天 ---------- */
    function renderFoodChat() {
        var el = $('screen-food-chat');
        var rider = foodState.chatRider || FOOD_RIDERS[1];
        var now = new Date();
        var stamp = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + fmtClock(now);
        el.innerHTML =
            '<header class="food-chat-nav">' +
                '<button type="button" class="food-nav__back" data-food-go="food-messages" aria-label="返回">' +
                '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 12H4"/><path d="M10 5l-7 7 7 7"/></svg></button>' +
                '<h1 class="food-chat-nav__title">骑士' + rider.name + '</h1>' +
                '<div class="food-chat-nav__right">' +
                    '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9 2 2 0 1 1-2.8 2.8 1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2 2 2 0 1 1-2.8-2.8A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9 2 2 0 1 1 2.8-2.8A1.7 1.7 0 0 0 9.9 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2 2 2 0 1 1 2.8 2.8A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z"/></svg>' +
                    '<span class="food-chat-nav__badge">99+</span>' +
                '</div>' +
            '</header>' +
            '<div class="food-scroll food-scroll--chat">' +
                '<div class="food-chat-order">' + foodImg('assets/food/logo-xiaofantang.png', 'food-chat-order__logo') +
                    '<div class="food-chat-order__body"><span class="food-chat-order__t">订单已送达</span>' +
                    '<span class="food-chat-order__s">小饭堂·隆江猪脚饭·潮汕汤粉(东平店)</span></div>' +
                    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#C2C8D0" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></div>' +
                '<div class="food-chat-time">' + stamp + '</div>' +
                '<div class="food-chat-msg">' + foodImg(rider.avatar, 'food-chat-msg__avatar') +
                    '<div class="food-chat-msg__bubble">外卖到了后门了</div></div>' +
                '<div class="food-chat-msg">' + foodImg(rider.avatar, 'food-chat-msg__avatar') +
                    '<div class="food-chat-msg__bubble">是给你放围墙哪里先吗</div></div>' +
                '<div class="food-chat-msg">' + foodImg(rider.avatar, 'food-chat-msg__avatar') +
                    '<div class="food-chat-msg__card"><span class="food-chat-msg__ct">订单已送达</span>' +
                    '<span class="food-chat-msg__cs">您好，货品已按照您的要求送达指定地点，请及时取件。</span>' +
                    '<div class="food-chat-msg__pics">' + foodImg('assets/food/chat-photo-a.jpg', 'food-chat-msg__pic') + foodImg('assets/food/chat-photo-b.jpg', 'food-chat-msg__pic') + '</div></div></div>' +
                '<div class="food-chat-msg">' + foodImg(rider.avatar, 'food-chat-msg__avatar') +
                    foodImg('assets/food/chat-photo-c.jpg', 'food-chat-msg__bigpic') + '</div>' +
                '<div class="food-chat-ended">会话已结束</div>' +
                '<div class="food-chat-tail"></div>' +
            '</div>';
        el.style.background = '#F2F3F5';
    }

    /* ---------- 6) AI 点餐（自定义预计送达时间） ---------- */
    function renderFoodAi() {
        var el = $('screen-food-ai');
        var auto = !foodState.eta;
        var val = etaLabel();
        el.innerHTML =
            foodNav('AI点餐', 'data-food-go="food"') +
            '<div class="food-scroll food-scroll--ai">' +
                '<div class="food-ai-hero">' +
                    '<div class="food-ai-hero__badge">AI</div>' +
                    '<h2 class="food-ai-hero__title">预计送达时间</h2>' +
                    '<p class="food-ai-hero__sub">这里设置的时间会同步到「我的」和「待收货」列表</p>' +
                    '<div class="food-ai-hero__clock" id="food-ai-clock">' + val + '</div>' +
                '</div>' +
                '<div class="food-card food-ai-card">' +
                    '<div class="food-ai-row">' +
                        '<span class="food-ai-row__l">跟随当前时间</span>' +
                        '<button type="button" class="food-switch' + (auto ? ' food-switch--on' : '') + '" id="food-ai-auto" aria-pressed="' + (auto ? 'true' : 'false') + '"><i></i></button>' +
                    '</div>' +
                    '<div class="food-ai-row food-ai-row--time">' +
                        '<span class="food-ai-row__l">指定时间</span>' +
                        '<input type="time" class="food-ai-time" id="food-ai-time" value="' + val + '"' + (auto ? ' disabled' : '') + '>' +
                    '</div>' +
                    '<div class="food-ai-quick">' +
                        '<button type="button" class="food-ai-chip" data-food-eta="15">15分钟后</button>' +
                        '<button type="button" class="food-ai-chip" data-food-eta="30">30分钟后</button>' +
                        '<button type="button" class="food-ai-chip" data-food-eta="45">45分钟后</button>' +
                        '<button type="button" class="food-ai-chip" data-food-eta="60">1小时后</button>' +
                    '</div>' +
                    '<p class="food-ai-tip">提示：点「跟随当前时间」后，每次打开都会显示当时的真实时间。</p>' +
                '</div>' +
                '<div class="food-ai-tail"></div>' +
            '</div>' + foodTabbar('ai');
        el.style.background = '#F5F6F7';
    }


/* ---------- 0) 外卖「推荐」首页 ---------- */
    var HOME_WORDS = ['奶茶', '姆斯汉堡', '轻食', '炸鸡', '水果'];
    var homeWordTimer = null;
    var homeWordIndex = 0;

    function startHomeWordLoop() {
        stopHomeWordLoop();
        homeWordTimer = setInterval(function () {
            if (currentPage !== 'food-home') {
                stopHomeWordLoop();
                return;
            }
            var inputs = [$('home-search-input'), $('home-search-input2')];
            var alive = inputs.filter(function (n) {
                return n && !n.value && document.activeElement !== n;
            });
            if (!alive.length) {
                return;
            }
            homeWordIndex = (homeWordIndex + 1) % HOME_WORDS.length;
            alive.forEach(function (n) {
                n.setAttribute('placeholder', HOME_WORDS[homeWordIndex]);
            });
        }, 2600);
    }

    function stopHomeWordLoop() {
        if (homeWordTimer) {
            clearInterval(homeWordTimer);
            homeWordTimer = null;
        }
    }

    var homeAdTimer = null;
    var HOME_AD_INDEX = 0;

    function startHomeAdLoop() {
        stopHomeAdLoop();
        homeAdTimer = setInterval(function () {
            if (currentPage !== 'food-home') {
                stopHomeAdLoop();
                return;
            }
            var track = $('home-ad-track');
            if (!track) {
                return;
            }
            HOME_AD_INDEX = (HOME_AD_INDEX + 1) % 2;
            track.style.transform = 'translateX(' + (-50 * HOME_AD_INDEX) + '%)';
            var dots = document.querySelectorAll('#screen-food-home .home-ad__dot');
            for (var i = 0; i < dots.length; i++) {
                dots[i].classList.toggle('home-ad__dot--on', i === HOME_AD_INDEX);
            }
        }, 4000);
    }

    function stopHomeAdLoop() {
        if (homeAdTimer) {
            clearInterval(homeAdTimer);
            homeAdTimer = null;
        }
    }

    function renderFoodHome() {
        var el = $('screen-food-home');
        var cats = [
            { icon: 'assets/food/cat-food.png', label: '美食外卖' },
            { icon: 'assets/food/cat-market.png', label: '超市便利' },
            { icon: 'assets/food/cat-drug.png', label: '看病买药' },
            { icon: 'assets/food/cat-fruit.png', label: '水果买菜' },
            { icon: 'assets/food/cat-flower.png', label: '鲜花礼品' }
        ];
        var tags = [
            { icon: 'assets/food/tag-hot.png', label: '爆火好店' },
            { icon: 'assets/food/tag-student.png', label: '学生福利' },
            { icon: 'assets/food/tag-dessert.png', label: '甜品饮品' },
            { icon: 'assets/food/tag-redpacket.png', label: '天天红包' },
            { icon: 'assets/food/tag-bean.png', label: '赚吃货豆' }
        ];
        var tabs = [
            { ico: 'assets/food/tab-ico-all.png', label: '全部', on: true },
            { ico: 'assets/food/tab-ico-campus.png', label: '校园食堂' },
            { ico: 'assets/food/tab-ico-single.png', label: '一人食' },
            { ico: 'assets/food/tab-ico-market.png', label: '超市便利' }
        ];
        var filters = [
            { ico: 'assets/food/filter-ico-gift.png', label: '满20减20' },
            { ico: 'assets/food/filter-ico-shop.png', label: '堂食店' },
            { ico: 'assets/food/filter-ico-time.png', label: '15分钟' },
            { ico: '', label: '免配送费' },
            { ico: '', label: '筛选' }
        ];
        var groups = [
            { img: 'assets/food/group-mushroom.jpg', name: '菌菇米线', note: '本月点过2次', price: '12.46', id: 'gm' },
            { img: 'assets/food/group-chicken.jpg', name: '黄金鸡排堡+牛肉...', note: '热门榜店铺', price: '10.43', id: 'gc' },
            { img: 'assets/food/group-bowl.jpg', name: '农家一碗香木桶饭...', note: '点过该店', price: '11.5', id: 'gb' }
        ];
        var shops = [
            {
                id: 'mocksun', img: 'assets/food/shop-mocksun.jpg', badge: '附近上新',
                name: 'MOCKSUN生日蛋糕·动物奶油·冰淇淋',
                meta: '月售32 无堂食 无明厨亮灶',
                ship: '起送 ¥0 免配送费',
                eta: '41分钟 5.6km',
                rate: '4.9分', rateTxt: '蛋糕松软，甜蜜每一刻',
                chips: ['爆 18元', '2元店铺红包'], chipRed: true, close: true, fold: true
            },
            {
                id: 'shusanshi', img: 'assets/food/shop-shusanshi.jpg', badge: '校园送',
                name: '蔬三时·轻食·健康餐(嘉禾望岗店)',
                meta: '月售3000+ 无明厨亮灶',
                ship: '起送 ¥40 配送 约¥3.8',
                eta: '35分钟 6.4km',
                rate: '4.7分', rateTxt: '望岗健康餐热销榜·第3名',
                chips: ['爆 29元', '1元店铺红包'], chipRed: true
            },
            {
                id: 'xianmiao', img: 'assets/food/shop-xianmiao.png', badge: '校园送',
                name: '武大烧鸡',
                meta: '月售800+ 明厨亮灶',
                ship: '起送 ¥15 满39配送 约¥1.2',
                eta: '35分钟 6.2km',
                rate: '4.6分', rateTxt: '接受预订 16:30开始配送',
                chips: ['爆 27元', '食无忧', '线上开票', '慢必赔'], chipRed: false
            },
            {
                id: 'brothers', img: 'assets/food/shop-brothers.png', badge: '校园送',
                name: '兄弟湛江鸭仔饭',
                meta: '月售9999+ 明厨亮灶',
                ship: '起送 ¥15 满39配送 约¥0.5',
                eta: '31分钟 4.4km',
                rate: '4.5分', rateTxt: '249人尝过都说好，价格实惠，料足！',
                chips: ['爆 23元', '2元店铺红包', '食无忧'], chipRed: true
            },
            {
                id: 'zhanyu', img: 'assets/food/shop-zhanyu.jpg', badge: '校园送',
                name: '绽语·S-Kitchen·四季轻食(设计之...',
                meta: '月售4000+ 明厨亮灶',
                ship: '起送 ¥15 配送 约¥0.5',
                eta: '33分钟 5.9km',
                rate: '4.8分', rateTxt: '千人回购 21人觉得吃得很满足',
                chips: ['爆 25元', '优评领1元店铺券', '安心吃'], chipRed: true
            },
            {
                id: 'binjolin', img: 'assets/food/shop-binjolin.jpg', badge: '校园送',
                name: 'BinjoLin槟知蕉林轻食(设计之都店)',
                meta: '月售800+ 明厨亮灶',
                ship: '起送 ¥60 配送 约¥5.8',
                eta: '34分钟 6.2km',
                rate: '4.9分', rateTxt: '65人觉得好吃 近期130人好评',
                chips: ['爆 21元', '首次光顾减2'], chipRed: true
            }
        ];

        function shopCardHtml(sp) {
            return '<div class="home-shop" data-food-shop="' + sp.id + '">' +
                '<div class="home-shop__pic">' + foodImg(sp.img, 'home-shop__img') +
                    (sp.badge ? '<span class="home-shop__badge">' + sp.badge + '</span>' : '') + '</div>' +
                '<div class="home-shop__body">' +
                    '<div class="home-shop__name">' + sp.name + '</div>' +
                    (sp.close ? '<span class="home-shop__close">✕</span>' : '') +
                    '<div class="home-shop__meta">' + sp.meta + '</div>' +
                    '<div class="home-shop__ship">' + sp.ship + '<span class="home-shop__eta">' + sp.eta + '</span></div>' +
                    '<div class="home-shop__rate"><b>' + sp.rate + '</b><span>' + sp.rateTxt + '</span></div>' +
                    '<div class="home-shop__chips">' + sp.chips.map(function (c) {
                        return '<span class="home-chip' + (sp.chipRed && c.indexOf('爆') === 0 ? ' home-chip--red' : '') + '">' + c + '</span>';
                    }).join('') + '</div>' +
                '</div>' +
                (sp.fold ? '<span class="home-shop__fold">⌄</span>' : '') +
                '</div>';
        }

        el.innerHTML =
            '<div class="food-scroll food-scroll--home" id="home-scroll">' +
                '<div class="home-hero">' +
                    '<div class="home-loc" data-food-go="food-address">' +
                        '<span class="home-loc__tag">常用</span>' +
                        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>' +
                        '<span class="home-loc__addr">' + escapeHtml(foodAddr.addr) + '</span>' +
                        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>' +
                    '</div>' +
                    '<div class="home-search">' +
                        foodImg('assets/food/home-search-scan.png', 'home-search__scan') +
                        '<div class="home-search__box"><input class="home-search__input" id="home-search-input" type="tel" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="' + HOME_WORDS[homeWordIndex] + '"></div>' +
                        '<button type="button" class="home-search__btn">搜索</button>' +
                    '</div>' +
                '</div>' +
                '<div class="home-stickybar" id="home-stickybar">' +
                    '<div class="home-search home-search--compact">' +
                        foodImg('assets/food/home-search-scan.png', 'home-search__scan') +
                        '<div class="home-search__box"><input class="home-search__input" id="home-search-input2" type="tel" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="' + HOME_WORDS[homeWordIndex] + '"></div>' +
                        '<button type="button" class="home-search__btn">搜索</button>' +
                    '</div>' +
                '</div>' +
                '<div class="home-tabs">' + tabs.map(function (t) {
                    return '<span class="home-tabs__item' + (t.on ? ' home-tabs__item--on' : '') + '">' +
                        (t.ico ? foodImg(t.ico, 'home-tabs__ico') : '') + t.label + '</span>';
                }).join('') +
                '</div>' +
                '<div class="home-cats">' + cats.map(function (c) {
                    return '<div class="home-cat">' + foodImg(c.icon, 'home-cat__icon') +
                        '<span class="home-cat__label">' + c.label + '</span></div>';
                }).join('') + '</div>' +
                '<div class="home-cats home-cats--tags">' + tags.map(function (c) {
                    return '<div class="home-cat home-cat--tag">' + foodImg(c.icon, 'home-cat__icon home-cat__icon--tag') +
                        '<span class="home-cat__label">' + c.label + '</span></div>';
                }).join('') + '</div>' +
                '<div class="home-duo">' +
                    '<div class="home-duo__card">' +
                        '<div class="home-duo__hd"><b>爆品团</b>' +
                            '<span class="home-duo__badge home-duo__badge--r">免凑单</span>' +
                            '<span class="home-duo__badge home-duo__badge--r">免运费</span>' +
                            '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#999" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></div>' +
                        '<div class="home-duo__body">' + foodImg('assets/food/item-kaoya.png', 'home-duo__img') +
                            '<div class="home-duo__txt"><span class="home-duo__name">手撕烤鸭+时蔬+榨菜+米饭</span>' +
                            '<span class="home-duo__price">¥<b>10.3</b><i>到手价</i></span></div></div>' +
                    '</div>' +
                    '<div class="home-duo__card">' +
                        '<div class="home-duo__hd"><b>天猫超市</b>' +
                            '<span class="home-duo__badge home-duo__badge--r">叠红包更优惠</span>' +
                            '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#999" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></div>' +
                        '<div class="home-duo__body">' + foodImg('assets/food/item-mango.png', 'home-duo__img') +
                            '<div class="home-duo__txt"><span class="home-duo__name">良品铺子 良品铺子芒果干...</span>' +
                            '<span class="home-duo__price"><b>¥2.4</b><s>¥9.9</s></span></div></div>' +
                    '</div>' +
                '</div>' +
                '<div class="home-filters">' + filters.map(function (f) {
                    return '<span class="home-filter' + (f.label === '筛选' ? ' home-filter--last' : '') + '">' +
                        (f.ico ? foodImg(f.ico, 'home-filter__ico') : '') + f.label + '</span>';
                }).join('') + '</div>' +
                '<div class="home-shops">' + shops.slice(0, 1).map(shopCardHtml).join('') + '</div>' +
                '<div class="home-ads">' +
                    '<div class="home-ad__track" id="home-ad-track">' +
                        foodImg('assets/food/ad-20redpacket.jpg', 'home-ad__img') +
                        foodImg('assets/food/ad-alt2.jpg', 'home-ad__img') +
                    '</div>' +
                    '<div class="home-ad__dots"><i class="home-ad__dot home-ad__dot--on"></i><i class="home-ad__dot"></i></div>' +
                '</div>' +
                '<div class="home-group">' +
                    '<div class="home-group__hd"><b>爆品团</b><span>免凑单免运费，到手价吃到饱！</span>' +
                        '<span class="home-group__more">更多<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#999" stroke-width="2.4" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></span></div>' +
                    '<div class="home-group__row">' + groups.map(function (g) {
                        return '<div class="home-group__item" data-food-item="' + g.id + '">' +
                            foodImg(g.img, 'home-group__img') +
                            '<span class="home-group__note">' + g.note + '</span>' +
                            '<span class="home-group__name">' + g.name + '</span>' +
                            '<span class="home-group__price">¥<b>' + g.price + '</b><i>一口价</i></span>' +
                            '</div>';
                    }).join('') + '</div>' +
                '</div>' +
                '<div class="home-shops">' + shops.slice(1).map(shopCardHtml).join('') + '</div>' +
                '<div class="home-tail"></div>' +
            '</div>' + foodTabbar('home');
        el.style.background = '#F5F6F7';

        // 吸顶：滚过 hero 后，顶部浮出一条固定搜索栏
        var sc = $('home-scroll');
        var bar = $('home-stickybar');
        if (sc && bar) {
            sc.addEventListener('scroll', function () {
                var on = sc.scrollTop > 96;
                bar.classList.toggle('home-stickybar--on', on);
            }, { passive: true });
        }
        startHomeWordLoop();
        startHomeAdLoop();
    }
    /* ---------- 0b) 收货地址 / 电话 自定义 ---------- */
    function renderFoodAddress() {
        var el = $('screen-food-address');
        el.innerHTML =
            foodNav('收货地址', 'data-food-go="food-home"') +
            '<div class="food-scroll food-scroll--addr">' +
                '<div class="food-card food-addr-card">' +
                    '<label class="food-addr-row"><span>收货人</span>' +
                        '<input type="text" id="food-addr-name" value="' + escapeHtml(foodAddr.name) + '" placeholder="晴"></label>' +
                    '<label class="food-addr-row"><span>联系电话</span>' +
                        '<input type="tel" id="food-addr-phone" value="' + escapeHtml(foodAddr.phone) + '" placeholder="11451419191"></label>' +
                    '<label class="food-addr-row"><span>收货地址</span>' +
                        '<input type="text" id="food-addr-text" value="' + escapeHtml(foodAddr.addr) + '" placeholder="广东警官学院嘉禾校区后门"></label>' +
                    '<p class="food-addr-tip">该地址会同步到「推荐」首页顶部与订单详情页的「送至」。</p>' +
                    '<div class="food-addr-acts">' +
                        '<button type="button" class="food-btn food-btn--ghost2" id="food-addr-reset">恢复默认</button>' +
                        '<button type="button" class="food-btn food-btn--primary" id="food-addr-save">保存</button>' +
                    '</div>' +
                '</div>' +
                '<div class="food-addr-tail"></div>' +
            '</div>';
        el.style.background = '#F2F6F9';
    }

/* ---------- 店铺详情 / 商品详情 ---------- */
    var FOOD_GOODS = {
        mocksun: {
            name: 'MOCKSUN生日蛋糕·动物奶油·冰淇淋',
            rate: '4.9', sales: '月售32', eta: '41分钟', dist: '5.6km',
            cover: 'assets/food/shop-mocksun.jpg',
            items: [
                { id: 'm1', img: 'assets/food/shop-mocksun.jpg', name: '【爆款】草莓动物奶油蛋糕 6寸', tags: ['月售12', '回头客多'], price: 88, origin: 128 },
                { id: 'm2', img: 'assets/food/item-mango.png', name: '芒果慕斯小方 甜品拼盘', tags: ['月售6'], price: 36, origin: 48 }
            ]
        },
        shusanshi: {
            name: '蔬三时·轻食·健康餐(嘉禾望岗店)',
            rate: '4.7', sales: '月售3000+', eta: '35分钟', dist: '6.4km',
            cover: 'assets/food/shop-shusanshi.jpg',
            items: [
                { id: 's1', img: 'assets/food/shop-shusanshi.jpg', name: '低脂鸡胸沙拉碗 双人份', tags: ['热销第1'], price: 39.9, origin: 56 },
                { id: 's2', img: 'assets/food/group-mushroom.jpg', name: '菌菇藜麦暖沙拉', tags: ['本月点过2次'], price: 26.8, origin: 33 },
                { id: 's3', img: 'assets/food/group-chicken.jpg', name: '香煎鸡排轻食套餐', tags: ['高蛋白'], price: 32, origin: 42 }
            ]
        },
        xianmiao: {
            name: '武大烧鸡',
            rate: '4.6', sales: '月售800+', eta: '35分钟', dist: '6.2km',
            cover: 'assets/food/shop-xianmiao.png',
            items: [
                { id: 'x1', img: 'assets/food/food-roast-chicken.jpg', name: '巨烧心  招牌武大鸡半只', tags: ['月售200+'], price: 78, origin: 91 },
                { id: 'x2', img: 'assets/food/group-chicken.jpg', name: '黄金鸡排堡+可乐套餐', tags: ['热门榜'], price: 25.9, origin: 36 },
                { id: 'x3', img: 'assets/food/group-bowl.jpg', name: '香米饭 木桶装', tags: ['加购'], price: 3, origin: 5 }
            ]
        },
        brothers: {
            name: '兄弟湛江鸭仔饭',
            rate: '4.5', sales: '月售9999+', eta: '31分钟', dist: '4.4km',
            cover: 'assets/food/shop-brothers.png',
            items: [
                { id: 'b1', img: 'assets/food/shop-brothers.png', name: '湛江白切鸭 半只 配姜葱汁', tags: ['月售3000+'], price: 42, origin: 55 },
                { id: 'b2', img: 'assets/food/group-bowl.jpg', name: '鸭油饭 大碗', tags: ['招牌'], price: 6, origin: 8 },
                { id: 'b3', img: 'assets/food/group-mushroom.jpg', name: '菌菇鸭汤', tags: ['暖胃'], price: 18, origin: 24 }
            ]
        },
        zhanyu: {
            name: '绽语·S-Kitchen·四季轻食',
            rate: '4.8', sales: '月售4000+', eta: '33分钟', dist: '5.9km',
            cover: 'assets/food/shop-zhanyu.jpg',
            items: [
                { id: 'z1', img: 'assets/food/shop-zhanyu.jpg', name: '原切牛排轻食拼盘', tags: ['千人回购'], price: 58, origin: 78 },
                { id: 'z2', img: 'assets/food/group-chicken.jpg', name: '鸡胸肉沙拉套餐', tags: ['低脂'], price: 29.9, origin: 39 },
                { id: 'z3', img: 'assets/food/group-bowl.jpg', name: '四季蔬菜碗', tags: ['素食'], price: 21, origin: 28 }
            ]
        },
        binjolin: {
            name: 'BinjoLin槟知蕉林轻食(设计之都店)',
            rate: '4.9', sales: '月售800+', eta: '34分钟', dist: '6.2km',
            cover: 'assets/food/shop-binjolin.jpg',
            items: [
                { id: 'n1', img: 'assets/food/shop-binjolin.jpg', name: '蕉林轻食双人餐', tags: ['近期130人好评'], price: 66, origin: 88 },
                { id: 'n2', img: 'assets/food/group-mushroom.jpg', name: '菌菇米线 小份', tags: ['本月点过2次'], price: 12.46, origin: 18 },
                { id: 'n3', img: 'assets/food/group-chicken.jpg', name: '黄金鸡排堡 单点', tags: ['热门'], price: 10.43, origin: 15 }
            ]
        }
    };

    var FOOD_GROUP_ITEMS = {
        gm: { name: '菌菇米线', price: 12.46, origin: 18, img: 'assets/food/group-mushroom.jpg', shop: '蒙自源', sales: '月售1800+', note: '本月点过2次' },
        gc: { name: '黄金鸡排堡+牛肉双拼套餐', price: 10.43, origin: 21, img: 'assets/food/group-chicken.jpg', shop: 'KAOLA YOU MI', sales: '月售2600+', note: '热门榜店铺' },
        gb: { name: '农家一碗香木桶饭', price: 11.5, origin: 19, img: 'assets/food/group-bowl.jpg', shop: '农家小碗菜', sales: '月售900+', note: '点过该店' }
    };

    function renderFoodShop(shopId) {
        var el = $('screen-food-shop');
        var sp = FOOD_GOODS[shopId] || FOOD_GOODS.mocksun;
        el.innerHTML =
            '<div class="food-scroll food-scroll--shop">' +
                '<div class="shop-cover">' + foodImg(sp.cover, 'shop-cover__img') +
                    '<div class="shop-cover__mask"></div>' +
                    '<div class="shop-cover__nav">' +
                        '<button type="button" class="shop-cover__btn" data-food-back aria-label="返回">' +
                            '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M20 12H4"/><path d="M10 5l-7 7 7 7"/></svg>' +
                        '</button>' +
                        '<span class="shop-cover__title">' + sp.name + '</span>' +
                        '<button type="button" class="shop-cover__btn" aria-label="更多">' +
                            '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>' +
                        '</button>' +
                    '</div>' +
                    '<div class="shop-cover__info">' +
                        '<div class="shop-cover__row"><b>' + sp.rate + '</b><span>分</span>' +
                            '<i>' + sp.sales + '</i><i>' + sp.eta + ' ' + sp.dist + '</i></div>' +
                        '<div class="shop-cover__row shop-cover__row--sub"><span>免配送费</span><span>起送 ¥15</span><span>支持自取</span></div>' +
                    '</div>' +
                '</div>' +
                '<div class="shop-tabs">' +
                    '<span class="shop-tabs__item shop-tabs__item--on">点菜</span>' +
                    '<span class="shop-tabs__item">评价</span>' +
                    '<span class="shop-tabs__item">商家</span>' +
                '</div>' +
                '<div class="shop-goods">' + sp.items.map(function (it) {
                    return '<div class="shop-good" data-food-item="' + it.id + '" data-shop="' + shopId + '">' +
                        foodImg(it.img, 'shop-good__img') +
                        '<div class="shop-good__body">' +
                            '<div class="shop-good__name">' + it.name + '</div>' +
                            '<div class="shop-good__tags">' + it.tags.map(function (t) { return '<span class="shop-good__tag">' + t + '</span>'; }).join('') + '</div>' +
                            '<div class="shop-good__bottom"><span class="shop-good__price">¥<b>' + it.price + '</b>' +
                                (it.origin ? '<s>¥' + it.origin + '</s>' : '') + '</span>' +
                                '<button type="button" class="shop-good__add">＋</button></div>' +
                        '</div></div>';
                }).join('') + '</div>' +
                '<div class="shop-tail"></div>' +
            '</div>' +
            '<div class="shop-cartbar">' +
                '<div class="shop-cartbar__cart"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#8A929C" stroke-width="1.9" stroke-linecap="round"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h2.5l2.2 11.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L21 7H6"/></svg>' +
                    '<span class="shop-cartbar__count">0</span></div>' +
                '<span class="shop-cartbar__price">未选购商品</span>' +
                '<button type="button" class="shop-cartbar__btn">去结算</button>' +
            '</div>';
        el.style.background = '#F5F6F7';
    }

    function renderFoodItem(itemId, shopId) {
        var el = $('screen-food-item');
        var g = FOOD_GROUP_ITEMS[itemId];
        // 爆品团商品不继承上一个店铺
        var sp = g ? null : FOOD_GOODS[shopId];
        var it = null;
        if (sp) {
            sp.items.forEach(function (x) { if (x.id === itemId) { it = x; } });
        }
        var data = it || g;
        // 「密码商品」：点进来就激活密码，价格改成「标价 + 原价」这对数字
        var passInfo = null;
        if (it && it.isPass) {
            passInfo = activateFoodPass();
            data = {
                name: it.name,
                price: passInfo.price,
                origin: passInfo.origin,
                img: it.img,
                tags: it.tags
            };
        }
        if (!data) {
            data = { name: '商品', price: 0, img: 'assets/food/group-bowl.jpg', sales: '', note: '' };
        }
        var title = data.name;
        var img = data.img;
        var sales = it ? (it.tags && it.tags[0]) : (g && g.sales);
        var shopName = sp ? sp.name : (g ? g.shop : '');
        el.innerHTML =
            '<div class="food-scroll food-scroll--item">' +
                '<div class="item-nav">' +
                    '<button type="button" class="item-nav__btn" data-food-back aria-label="返回">' +
                        '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"><path d="M20 12H4"/><path d="M10 5l-7 7 7 7"/></svg></button>' +
                    '<span class="item-nav__title">商品详情</span>' +
                    '<span class="item-nav__right"></span>' +
                '</div>' +
                '<div class="item-cover">' + foodImg(img, 'item-cover__img') + '</div>' +
                '<div class="item-main">' +
                    '<div class="item-main__price">¥<b>' + data.price + '</b>' +
                        (data.origin ? '<s>¥' + data.origin + '</s>' : '') + '</div>' +
                    '<div class="item-main__name">' + title + '</div>' +
                    (sales ? '<div class="item-main__sales">' + sales + '</div>' : '') +
                    (shopName ? '<div class="item-main__shop" data-food-shop="' + (shopId || '') + '">' + shopName +
                        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#999" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></div>' : '') +
                '</div>' +
                '<div class="item-desc">' +
                    '<div class="item-desc__hd">商品信息</div>' +
                    '<div class="item-desc__row"><span>规格</span><b>默认规格</b></div>' +
                    '<div class="item-desc__row"><span>餐具</span><b>无需餐具</b></div>' +
                    '<div class="item-desc__row"><span>配送</span><b>' + (sp ? sp.eta + ' ' + sp.dist : '35分钟') + '</b></div>' +
                '</div>' +
                '<div class="item-tail"></div>' +
            '</div>' +
            '<div class="item-buybar">' +
                '<button type="button" class="item-buybar__fav">☆<span>收藏</span></button>' +
                '<button type="button" class="item-buybar__add">加入购物车</button>' +
            '</div>';
        el.style.background = '#F5F6F7';
    }

    /* ---------- 密码校验 + 作者求打赏彩蛋 ---------- */
    // 输错时的彩蛋：不暴露"密码"这件事，只说搜索在路上 + 求打赏
    function showDonateEgg() {
        var old = $('food-donate');
        if (old) {
            old.parentNode.removeChild(old);
        }
        var box = document.createElement('div');
        box.id = 'food-donate';
        box.className = 'food-donate';
        box.innerHTML =
            '<div class="food-donate__card">' +
                '<div class="food-donate__emoji">🙏</div>' +
                '<div class="food-donate__title">搜索还在路上</div>' +
                '<div class="food-donate__sub">作者一个人肝了很久，求个打赏支持～</div>' +
                '<button type="button" class="food-donate__ok">我这就去</button>' +
            '</div>';
        document.body.appendChild(box);
        requestAnimationFrame(function () {
            box.classList.add('food-donate--on');
        });
        var close = function () {
            box.classList.remove('food-donate--on');
            setTimeout(function () {
                if (box.parentNode) {
                    box.parentNode.removeChild(box);
                }
            }, 220);
        };
        box.addEventListener('click', function (e) {
            if (e.target === box || (e.target.closest && e.target.closest('.food-donate__ok'))) {
                close();
            }
        });
        setTimeout(close, 3000);
    }

    function copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(function () {});
                return true;
            }
        } catch (e) { /* ignore */ }
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return true;
        } catch (e2) { /* ignore */ }
        return false;
    }

    // 密码校验：只有「已经点过加号激活」的密码才有效；默认那组永远不通过
    // 纯外卖版：搜索还没做，输什么都只是弹打赏
    function submitFoodPass(raw) {
        var a = $('home-search-input');
        var b = $('home-search-input2');
        if (a) { a.value = ''; }
        if (b) { b.value = ''; }
        showDonateEgg();
    }

    /* ---------- 黑屏过场：先黑屏 2s，再进企微（两步都无动画） ---------- */
    var enterSplashTimer = null;

    function startEnterSplash() {
        var el = $('screen-splash');
        if (!el) {
            go('workbench', null);
            return;
        }
        el.innerHTML =
            '<div class="splash">' +
                '<div class="splash__logo">' +
                    '<svg viewBox="0 0 120 64" width="120" height="64" fill="none">' +
                        '<defs><linearGradient id="splashGrad" x1="0" y1="0" x2="1" y2="1">' +
                            '<stop offset="0%" stop-color="#5B8DEF"/><stop offset="55%" stop-color="#8E6BF2"/><stop offset="100%" stop-color="#F26BA8"/>' +
                        '</linearGradient></defs>' +
                        '<path d="M30 8C15 8 4 18 4 31c0 8 4 15 11 19l-3 11 12-6c2 .4 4 .6 6 .6 15 0 26-10 26-23S45 8 30 8z" stroke="url(#splashGrad)" stroke-width="5.5" stroke-linejoin="round"/>' +
                        '<circle cx="97" cy="23" r="4.6" fill="#F26BA8"/>' +
                        '<path d="M100 34l2.6 6.4 6.4 2.6-6.4 2.6L100 52l-2.6-6.4-6.4-2.6 6.4-2.6z" fill="#8E6BF2" opacity="0.95"/>' +
                        '<path d="M97 4l2.2 5.4 5.4 2.2-5.4 2.2L97 19l-2.2-5.2-5.4-2.2 5.4-2.2z" fill="#F26BA8" opacity="0.85"/>' +
                    '</svg>' +
                    '<span class="splash__ai">AI</span>' +
                '</div>' +
                '<div class="splash__title">请切换为夜间模式（深色模式）</div>' +
                '<div class="splash__sub">已将烧鸡密码复制到剪贴板</div>' +
            '</div>';
        showInstant('splash');
        clearTimeout(enterSplashTimer);
        enterSplashTimer = setTimeout(function () {
            // 直接把历史替换成企微工作台，避免返回时又回到黑屏
            history.replaceState({ qj: 1, page: 'workbench', id: null, d: 0 }, '', hashOf('workbench', null));
            render('workbench', null, 'none');
            showInstant('workbench');
        }, 2000);
    }

    /* ---------- 外卖模块：事件 ---------- */
    function foodGo(page, id) {
        go(page, id);
    }

    function bindFoodEvents() {
        var app = $('app');
        app.addEventListener('click', function (e) {
            // 搜索：点「搜索」按钮校验密码
            var searchBtn = e.target.closest('.home-search__btn');
            if (searchBtn) {
                var box = searchBtn.parentNode.querySelector('.home-search__input');
                submitFoodPass(box ? box.value : '');
                return;
            }
            var shopEl = e.target.closest('[data-food-shop]');
            if (shopEl && shopEl.getAttribute('data-food-shop')) {
                foodState.shopId = shopEl.getAttribute('data-food-shop');
                go('food-shop', null);
                return;
            }
            var itemEl = e.target.closest('[data-food-item]');
            if (itemEl) {
                if (itemEl.getAttribute('data-shop')) { foodState.shopId = itemEl.getAttribute('data-shop'); }
                foodState.itemId = itemEl.getAttribute('data-food-item');
                go('food-item', null);
                return;
            }
            var chat = e.target.closest('[data-food-chat]');
            if (chat) {
                foodState.chatRider = riderByName(chat.getAttribute('data-food-chat'));
                go('food-chat', null);
                return;
            }
            var tab = e.target.closest('[data-food-tab]');
            if (tab) {
                foodState.ordersTab = tab.getAttribute('data-food-tab');
                renderFoodOrders();
                return;
            }
            var etaChip = e.target.closest('[data-food-eta]');
            if (etaChip) {
                var mins = parseInt(etaChip.getAttribute('data-food-eta'), 10) || 0;
                var t = new Date(Date.now() + mins * 60000);
                foodState.eta = fmtClock(t);
                saveFoodEta(foodState.eta);
                renderFoodAi();
                return;
            }
            if (e.target.closest('#food-addr-save')) {
                var nEl = $('food-addr-name');
                var pEl = $('food-addr-phone');
                var aEl = $('food-addr-text');
                foodAddr.name = (nEl && nEl.value.trim()) || FOOD_ADDR_DEFAULT.name;
                foodAddr.phone = (pEl && pEl.value.trim()) || FOOD_ADDR_DEFAULT.phone;
                foodAddr.addr = (aEl && aEl.value.trim()) || FOOD_ADDR_DEFAULT.addr;
                saveFoodAddr();
                go('food-home', null);
                return;
            }
            if (e.target.closest('#food-addr-reset')) {
                foodAddr.name = FOOD_ADDR_DEFAULT.name;
                foodAddr.phone = FOOD_ADDR_DEFAULT.phone;
                foodAddr.addr = FOOD_ADDR_DEFAULT.addr;
                saveFoodAddr();
                renderFoodAddress();
                return;
            }
            if (e.target.closest('#food-ai-auto')) {
                foodState.eta = foodState.eta ? null : fmtClock(new Date());
                saveFoodEta(foodState.eta);
                renderFoodAi();
                return;
            }
            var back = e.target.closest('[data-food-back]');
            if (back) {
                backOr(currentPage);
                return;
            }
            var target = e.target.closest('[data-food-go]');
            if (target) {
                go(target.getAttribute('data-food-go'), null);
            }
        });

        // 搜索：输入框回车也校验
        app.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') {
                return;
            }
            if (e.target && e.target.classList && e.target.classList.contains('home-search__input')) {
                e.preventDefault();
                submitFoodPass(e.target.value);
            }
        });

        app.addEventListener('change', function (e) {
            if (e.target && e.target.id === 'food-ai-time') {
                foodState.eta = e.target.value || null;
                saveFoodEta(foodState.eta);
                renderFoodAi();
            }
        });

        // AI 页：跟随当前时间时，时钟实时走
        setInterval(function () {
            if (currentPage !== 'food-ai') {
                return;
            }
            var clock = $('food-ai-clock');
            if (clock) {
                clock.textContent = etaLabel();
            }
        }, 15000);
    }

    /* ============ 启动 ============ */
    var BUILD_TAG = 'leave-app build 2026-10-24 v3 (cover-transition)';

    function boot() {
        try { console.log(BUILD_TAG); } catch (e) { /* ignore */ }
        PAGES.forEach(function (p) {
            screens[p] = $('screen-' + p);
        });
        pageForm = $('page-form');
        pageResult = $('page-result');
        generateBtn = $('generate-btn');
        navBackArrow = $('nav-back-arrow');
        navBackX = $('nav-back-x');

        store.load();
        foodState.eta = loadFoodEta();
        loadFoodAddr();
        loadSavedData();
        bindEvents();
        bindFoodEvents();

        // file:// 打开时没有 service worker（手机本地文件模式），跳过注册避免报错
        var canUseSW = location.protocol === 'http:' || location.protocol === 'https:';
        if ('serviceWorker' in navigator && canUseSW) {
            window.addEventListener('load', function () {
                navigator.serviceWorker.register('./service-worker.js')
                    .then(function (registration) {
                        console.log('ServiceWorker 注册成功:', registration.scope);
                    })
                    .catch(function (err) {
                        console.log('ServiceWorker 注册失败:', err);
                    });
            });
        }

        if (/wxwork/i.test(navigator.userAgent)) {
            document.body.classList.add('is-wxwork');
        }

        var route = guardRoute(parseHash());
        if (route.page === 'shot') {
            var rec = store.get(route.id);
            if (rec) {
                currentRecordId = route.id;
                renderShot(rec);
                replaceWith('shot', route.id);
                showScreen('shot');
                return;
            }
            route = { page: 'workbench', id: null };
        }
        if (route.page !== 'workbench') {
            replaceWith(route.page, route.id);
            render(route.page, route.id, 'forward');
            return;
        }
        renderWorkbench();
        replaceWith('workbench', null);
        // 首屏之外的屏先彻底隐藏，避免任何残留层在过场里露出
        PAGES.forEach(function (p) {
            if (screens[p] && p !== 'workbench') {
                screens[p].style.display = 'none';
            }
        });
        showScreen('workbench');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
