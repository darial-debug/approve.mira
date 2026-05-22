/**
 * DateRangePicker — reusable calendar range selector.
 *
 * Usage:
 *   import { DateRangePicker } from './components/DateRangePicker.js';
 *   const picker = new DateRangePicker(document.getElementById('host'), {
 *     onChange: ({ start, end }) => console.log(start, end),
 *   });
 *
 * Selection: click 1 → start; click 2 → end (or new start if earlier);
 * click 3+ while range complete → reset and new start.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** @param {Date} d */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** @param {Date} d */
function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** @param {Date} d */
function formatDisplay(d) {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** @param {number} year @param {number} month 0-based */
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

const CHEVRON_UP = `<svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true"><path d="M1 5L5 1L9 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_DOWN = `<svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_RIGHT = `<svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true"><path d="M1 1L7 7L1 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export class DateRangePicker {
  /**
   * @param {HTMLElement} container
   * @param {{
   *   start?: Date | null,
   *   end?: Date | null,
   *   showFields?: boolean,
   *   fieldsPosition?: 'top' | 'bottom',
   *   onChange?: (range: { start: Date | null, end: Date | null }) => void,
   * }} [options]
   */
  constructor(container, options = {}) {
    this.container = container;
    this.onChange = options.onChange || (() => {});

    const today = startOfDay(new Date());
    this.viewYear = today.getFullYear();
    this.viewMonth = today.getMonth();
    this.today = today;

    this.start = options.start ? startOfDay(options.start) : null;
    this.end = options.end ? startOfDay(options.end) : null;
    this.hover = null;
    this.focused = this.start ? new Date(this.start) : new Date(today);
    if (this.start) {
      this.viewYear = this.start.getFullYear();
      this.viewMonth = this.start.getMonth();
    }

    this.showFields = options.showFields !== false;
    this.fieldsPosition = options.fieldsPosition || 'top';

    this._injectStyles();
    this.render();
    this._bind();
  }

  /** Load stylesheet once */
  _injectStyles() {
    if (document.querySelector('link[data-drp-styles]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/components/date-range-picker.css';
    link.setAttribute('data-drp-styles', '1');
    document.head.appendChild(link);
  }

  /** Visible month as Date (day 1) */
  get viewDate() {
    return new Date(this.viewYear, this.viewMonth, 1);
  }

  /** Effective range for highlighting (includes hover preview) */
  get effectiveRange() {
    const { start, end, hover } = this;
    if (!start) return { start: null, end: null };

    if (end) return { start, end };

    if (hover) {
      // Before start: preview only the hovered day as a potential new start
      if (hover < start) {
        return { start: hover, end: null, preview: true, previewNewStart: true };
      }
      return { start, end: hover, preview: true };
    }

    return { start, end: null };
  }

  /** @param {Date} date */
  _dayState(date) {
    const range = this.effectiveRange;
    const { start, end, preview, previewNewStart } = range;
    const d = startOfDay(date);
    const isOtherMonth = d.getMonth() !== this.viewMonth || d.getFullYear() !== this.viewYear;
    const isToday = sameDay(d, this.today);
    const isFocused = sameDay(d, this.focused);

    if (isOtherMonth) {
      return { empty: true, classes: [], isToday, isFocused };
    }

    const classes = [];
    if (isToday) classes.push('drp-day--today');

    if (!start) {
      return { disabled: false, classes, isToday, isFocused };
    }

    // Committed start with no end yet (and not previewing a new start elsewhere)
    if (
      !end &&
      !preview &&
      this.start &&
      sameDay(d, this.start)
    ) {
      classes.push('drp-day--start-only');
      return { disabled: false, classes, isToday, isFocused };
    }

    // Hover preview for a new start (date before current start)
    if (previewNewStart && sameDay(d, start)) {
      classes.push('drp-day--start-only');
      return { disabled: false, classes, isToday, isFocused };
    }

    const rangeEnd = end;
    const inRange = rangeEnd && d >= start && d <= rangeEnd;

    if (!inRange) {
      return { disabled: false, classes, isToday, isFocused };
    }

    const isStart = sameDay(d, start);
    const isEnd = rangeEnd && sameDay(d, rangeEnd);
    const isSingle = isStart && isEnd;

    if (preview) {
      if (isSingle) {
        classes.push('drp-day--range-start', 'drp-day--preview-end');
      } else {
        if (isStart) classes.push('drp-day--range-start');
        if (isEnd) classes.push('drp-day--preview-end');
        if (!isStart && !isEnd) classes.push('drp-day--preview');
      }
    } else if (isSingle) {
      classes.push('drp-day--range-start', 'drp-day--range-end');
    } else {
      if (isStart) classes.push('drp-day--range-start');
      if (isEnd) classes.push('drp-day--range-end');
      if (!isStart && !isEnd) classes.push('drp-day--in-range');
    }

    if (!isStart && !isEnd && inRange && rangeEnd) {
      const prev = new Date(d);
      prev.setDate(prev.getDate() - 1);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const prevIn = prev >= start && prev <= rangeEnd;
      const nextIn = next >= start && next <= rangeEnd;
      if (!prevIn || sameDay(prev, start)) classes.push('drp-day--segment-start');
      if (!nextIn || sameDay(next, rangeEnd)) classes.push('drp-day--segment-end');
    }

    return { disabled: false, classes, isToday, isFocused };
  }

  /** Calendar grid cells: 42 slots (6 weeks) */
  _buildGrid() {
    const first = new Date(this.viewYear, this.viewMonth, 1);
    const startPad = first.getDay();
    const dim = daysInMonth(this.viewYear, this.viewMonth);
    const cells = [];

    const prevDim = daysInMonth(
      this.viewMonth === 0 ? this.viewYear - 1 : this.viewYear,
      this.viewMonth === 0 ? 11 : this.viewMonth - 1,
    );

    for (let i = startPad - 1; i >= 0; i--) {
      const day = prevDim - i;
      const m = this.viewMonth === 0 ? 11 : this.viewMonth - 1;
      const y = this.viewMonth === 0 ? this.viewYear - 1 : this.viewYear;
      cells.push(new Date(y, m, day));
    }

    for (let d = 1; d <= dim; d++) {
      cells.push(new Date(this.viewYear, this.viewMonth, d));
    }

    let nextDay = 1;
    while (cells.length < 42) {
      const m = this.viewMonth === 11 ? 0 : this.viewMonth + 1;
      const y = this.viewMonth === 11 ? this.viewYear + 1 : this.viewYear;
      cells.push(new Date(y, m, nextDay++));
    }

    return cells;
  }

  _fieldsHTML() {
    if (!this.showFields) return '';
    const startVal = this.start ? formatDisplay(this.start) : '';
    const endVal = this.end ? formatDisplay(this.end) : '';
    return `
      <div class="drp-fields">
        <div class="drp-field">
          <label for="drp-start-${this._id}">Start date</label>
          <input id="drp-start-${this._id}" type="text" readonly
            value="${startVal}" placeholder="—" aria-live="polite" />
        </div>
        <div class="drp-field">
          <label for="drp-end-${this._id}">End date</label>
          <input id="drp-end-${this._id}" type="text" readonly
            value="${endVal}" placeholder="—" aria-live="polite" />
        </div>
      </div>`;
  }

  render() {
    this._id = this._id || Math.random().toString(36).slice(2, 9);
    const grid = this._buildGrid();
    const monthLabel = MONTHS[this.viewMonth];
    const monthAria = `${monthLabel} ${this.viewYear}`;

    const daysHTML = grid
      .map((date) => {
        const { empty, classes, isFocused } = this._dayState(date);
        if (empty) {
          return `<div class="drp-day drp-day--empty" role="presentation"></div>`;
        }
        const cls = ['drp-day', ...classes].filter(Boolean).join(' ');
        const label = date.toLocaleDateString(undefined, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        const ts = date.getTime();
        return `
          <div class="${cls}" role="presentation" data-ts="${ts}">
            <button type="button" class="drp-day-btn"
              data-ts="${ts}"
              tabindex="${isFocused ? 0 : -1}"
              aria-label="${label}"
              aria-selected="${this._isSelected(date) ? 'true' : 'false'}">
              ${date.getDate()}
            </button>
          </div>`;
      })
      .join('');

    const fields = this._fieldsHTML();
    const calendar = `
      <div class="drp-calendar" role="application" aria-label="Date range calendar">
        <div class="drp-header">
          <div class="drp-month-center">
            <span class="drp-month-title" id="drp-month-${this._id}" aria-live="polite">${monthLabel}</span>
            <div class="drp-month-chevrons">
              <button type="button" class="drp-chevron-btn" data-action="prev-month"
                aria-label="Previous month, ${monthAria}">${CHEVRON_UP}</button>
              <button type="button" class="drp-chevron-btn" data-action="next-month-down"
                aria-label="Next month, ${monthAria}">${CHEVRON_DOWN}</button>
            </div>
          </div>
          <button type="button" class="drp-next-btn" data-action="next-month"
            aria-label="Next month">${CHEVRON_RIGHT}</button>
        </div>
        <div class="drp-weekdays" aria-hidden="true">
          ${WEEKDAYS.map((w, i) => {
            const weekend = i === 0 || i === 6;
            return `<div class="drp-weekday${weekend ? ' drp-weekday--weekend' : ''}">${w}</div>`;
          }).join('')}
        </div>
        <div class="drp-grid" role="grid" aria-label="${monthAria}"
          aria-multiselectable="true">
          ${daysHTML}
        </div>
      </div>`;

    const fieldsBlock =
      this.fieldsPosition === 'bottom'
        ? `${calendar}${fields}`
        : `${fields}${calendar}`;

    this.container.innerHTML = `<div class="drp">${fieldsBlock}</div>`;
    this._root = this.container.querySelector('.drp');
  }

  /** @param {Date} date */
  _isSelected(date) {
    const d = startOfDay(date);
    if (this.start && sameDay(d, this.start)) return true;
    if (this.end && sameDay(d, this.end)) return true;
    const { start, end } = this.effectiveRange;
    if (start && end && d >= start && d <= end) return true;
    return false;
  }

  _bind() {
    this._root.addEventListener('click', (e) => this._onClick(e));
    this._root.addEventListener('mouseover', (e) => this._onHover(e));
    this._root.addEventListener('mouseleave', () => {
      if (this.hover) {
        this.hover = null;
        this.render();
        this._bind();
      }
    });
    this._root.addEventListener('keydown', (e) => this._onKeydown(e));
  }

  /** @param {MouseEvent} e */
  _onClick(e) {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === 'prev-month') this._shiftMonth(-1);
      else if (action === 'next-month' || action === 'next-month-down') this._shiftMonth(1);
      return;
    }

    const btn = e.target.closest('.drp-day-btn:not([disabled])');
    if (!btn) return;

    const date = startOfDay(new Date(Number(btn.dataset.ts)));
    this._selectDate(date);
  }

  /** @param {MouseEvent} e */
  _onHover(e) {
    const btn = e.target.closest('.drp-day-btn:not([disabled])');
    if (!btn || !this.start || this.end) return;
    const date = startOfDay(new Date(Number(btn.dataset.ts)));
    if (this.hover && sameDay(this.hover, date)) return;
    this.hover = date;
    this.render();
    this._bind();
  }

  /** @param {Date} date */
  _selectDate(date) {
    const d = startOfDay(date);
    this.focused = d;

    if (this.start && this.end) {
      this.start = d;
      this.end = null;
      this.hover = null;
      this._emit();
      this.render();
      this._bind();
      return;
    }

    if (!this.start) {
      this.start = d;
      this.end = null;
      this.hover = null;
      this._emit();
      this.render();
      this._bind();
      return;
    }

    if (d < this.start) {
      this.start = d;
      this.end = null;
      this.hover = null;
      this._emit();
      this.render();
      this._bind();
      return;
    }

    this.end = d;
    this.hover = null;
    this._emit();
    this.render();
    this._bind();
  }

  _shiftMonth(delta) {
    this.viewMonth += delta;
    if (this.viewMonth > 11) {
      this.viewMonth = 0;
      this.viewYear += 1;
    } else if (this.viewMonth < 0) {
      this.viewMonth = 11;
      this.viewYear -= 1;
    }
    this.render();
    this._bind();
  }

  /** @param {KeyboardEvent} e */
  _onKeydown(e) {
    const btn = e.target.closest('.drp-day-btn');
    if (!btn && !e.target.closest('[data-action]')) return;

    const key = e.key;
    let deltaDays = 0;
    let deltaMonth = 0;

    switch (key) {
      case 'ArrowLeft':
        deltaDays = -1;
        break;
      case 'ArrowRight':
        deltaDays = 1;
        break;
      case 'ArrowUp':
        deltaDays = -7;
        break;
      case 'ArrowDown':
        deltaDays = 7;
        break;
      case 'PageUp':
        e.preventDefault();
        deltaMonth = -1;
        break;
      case 'PageDown':
        e.preventDefault();
        deltaMonth = 1;
        break;
      case 'Home':
        e.preventDefault();
        this.focused = new Date(this.focused.getFullYear(), this.focused.getMonth(), 1);
        this._syncFocusView();
        return;
      case 'End': {
        e.preventDefault();
        const dim = daysInMonth(this.focused.getFullYear(), this.focused.getMonth());
        this.focused = new Date(this.focused.getFullYear(), this.focused.getMonth(), dim);
        this._syncFocusView();
        return;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (btn && !btn.disabled) this._selectDate(this.focused);
        return;
      default:
        return;
    }

    e.preventDefault();

    if (deltaMonth) {
      this._shiftMonth(deltaMonth);
      return;
    }

    const next = new Date(this.focused);
    next.setDate(next.getDate() + deltaDays);
    this.focused = startOfDay(next);
    this._syncFocusView();
  }

  _syncFocusView() {
    if (
      this.focused.getMonth() !== this.viewMonth ||
      this.focused.getFullYear() !== this.viewYear
    ) {
      this.viewMonth = this.focused.getMonth();
      this.viewYear = this.focused.getFullYear();
    }
    this.render();
    this._bind();
    const ts = this.focused.getTime();
    const el = this._root.querySelector(`.drp-day-btn[data-ts="${ts}"]:not([disabled])`);
    if (el) el.focus();
  }

  _emit() {
    this.onChange({ start: this.start, end: this.end });
  }

  /** @returns {{ start: Date | null, end: Date | null }} */
  getRange() {
    return { start: this.start, end: this.end };
  }

  /**
   * @param {{ start?: Date | null, end?: Date | null }} range
   */
  setRange({ start = null, end = null }) {
    this.start = start ? startOfDay(start) : null;
    this.end = end ? startOfDay(end) : null;
    if (this.start) {
      this.viewYear = this.start.getFullYear();
      this.viewMonth = this.start.getMonth();
      this.focused = new Date(this.start);
    }
    this.hover = null;
    this._emit();
    this.render();
    this._bind();
  }

  destroy() {
    this.container.innerHTML = '';
  }
}
