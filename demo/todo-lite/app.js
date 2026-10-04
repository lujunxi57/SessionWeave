/**
 * 待办清单 —— 原生 JS 实现
 *
 * 关键约束：
 * 1. 任务内容一律通过 textContent 写入 DOM，绝不使用 innerHTML 拼接用户输入。
 * 2. localStorage 读写包在 try/catch 中，隐私模式或存储损坏时不阻断使用。
 * 3. 列表采用「全量状态 → 过滤渲染」：DOM 是状态的纯函数输出，避免增量更新导致的状态漂移。
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'todo-lite:tasks:v1';
  var MAX_LENGTH = 200;

  /** 当前筛选：'all' | 'active' | 'done' */
  var filter = 'all';
  /** 内存中的任务数组，每项 { id: string, text: string, done: boolean, createdAt: number } */
  var tasks = [];
  var noticeTimer = null;

  var el = {
    form: document.getElementById('add-form'),
    input: document.getElementById('task-input'),
    notice: document.getElementById('notice'),
    filters: document.getElementById('filters'),
    list: document.getElementById('task-list'),
    empty: document.getElementById('empty-state'),
    counter: document.getElementById('counter'),
    clearDone: document.getElementById('clear-done')
  };

  /* ---------------- 持久化 ---------------- */

  function makeId() {
    // 优先使用 crypto.randomUUID，缺失时退化为时间戳 + 随机串。
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function isValidTask(item) {
    return (
      item &&
      typeof item === 'object' &&
      typeof item.text === 'string' &&
      typeof item.done === 'boolean'
    );
  }

  function load() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return [];
    }
    if (!raw) {
      return [];
    }
    try {
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(isValidTask).map(function (item) {
        return {
          id: typeof item.id === 'string' && item.id ? item.id : makeId(),
          text: item.text.slice(0, MAX_LENGTH),
          done: item.done,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now()
        };
      });
    } catch (err) {
      // 数据损坏：丢弃并从空状态开始，不阻塞页面。
      return [];
    }
  }

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (err) {
      showNotice('无法保存到本地存储，你的浏览器可能禁用了存储功能。');
    }
  }

  /* ---------------- 辅助 ---------------- */

  function showNotice(message) {
    el.notice.textContent = message;
    el.notice.hidden = false;
    if (noticeTimer !== null) {
      window.clearTimeout(noticeTimer);
    }
    noticeTimer = window.setTimeout(function () {
      el.notice.hidden = true;
      el.notice.textContent = '';
      noticeTimer = null;
    }, 4000);
  }

  function matchesFilter(task) {
    if (filter === 'active') {
      return !task.done;
    }
    if (filter === 'done') {
      return task.done;
    }
    return true;
  }

  /* ---------------- 渲染 ---------------- */

  function createTaskNode(task) {
    var li = document.createElement('li');
    li.className = 'task' + (task.done ? ' is-done' : '');
    li.dataset.id = task.id;

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task__toggle';
    checkbox.checked = task.done;
    checkbox.setAttribute('aria-label', '标记完成：' + task.text);
    checkbox.addEventListener('change', function () {
      toggleTask(task.id, checkbox.checked);
    });

    var text = document.createElement('span');
    text.className = 'task__text';
    // 安全要点：只写 textContent，用户输入中的 <、& 等字符按纯文本呈现。
    text.textContent = task.text;

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'task__delete';
    remove.textContent = '删除';
    remove.setAttribute('aria-label', '删除任务：' + task.text);
    remove.addEventListener('click', function () {
      removeTask(task.id);
    });

    li.append(checkbox, text, remove);
    return li;
  }

  function render() {
    var fragment = document.createDocumentFragment();
    var visibleCount = 0;

    tasks.forEach(function (task) {
      if (!matchesFilter(task)) {
        return;
      }
      visibleCount += 1;
      fragment.appendChild(createTaskNode(task));
    });

    // 整体替换：清空列表不使用 innerHTML，避免任何 HTML 解析。
    el.list.replaceChildren(fragment);
    el.empty.hidden = visibleCount > 0;

    el.filters.querySelectorAll('.filters__item').forEach(function (button) {
      var isActive = button.dataset.filter === filter;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-current', isActive ? 'true' : 'false');
    });

    var remaining = tasks.reduce(function (sum, task) {
      return task.done ? sum : sum + 1;
    }, 0);
    el.counter.textContent = remaining === 0 ? '全部完成' : remaining + ' 项未完成';
    el.clearDone.disabled = !tasks.some(function (task) {
      return task.done;
    });
  }

  /* ---------------- 操作 ---------------- */

  function addTask(rawText) {
    var text = String(rawText == null ? '' : rawText).trim();
    if (text === '') {
      showNotice('任务内容不能为空。');
      return false;
    }
    if (text.length > MAX_LENGTH) {
      text = text.slice(0, MAX_LENGTH);
    }
    tasks.push({ id: makeId(), text: text, done: false, createdAt: Date.now() });
    save();
    render();
    return true;
  }

  function toggleTask(id, done) {
    tasks = tasks.map(function (task) {
      return task.id === id ? Object.assign({}, task, { done: done }) : task;
    });
    save();
    render();
  }

  function removeTask(id) {
    tasks = tasks.filter(function (task) {
      return task.id !== id;
    });
    save();
    render();
  }

  function clearDone() {
    tasks = tasks.filter(function (task) {
      return !task.done;
    });
    save();
    render();
  }

  /* ---------------- 事件绑定 ---------------- */

  el.form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (addTask(el.input.value)) {
      el.input.value = '';
      el.input.focus();
    }
  });

  el.filters.addEventListener('click', function (event) {
    var button = event.target.closest('.filters__item');
    if (!button) {
      return;
    }
    filter = button.dataset.filter;
    render();
  });

  el.clearDone.addEventListener('click', clearDone);

  /* ---------------- 启动 ---------------- */

  tasks = load();
  render();
})();
