import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  AcademicCalendarEventItem,
  AcademicEventCategory,
  UserProfile,
} from '../types';

interface AcademicCalendarCardProps {
  token: string;
  user: UserProfile;
  todayIsoDate?: string;
}

const CATEGORY_LABELS: Record<AcademicEventCategory, string> = {
  event: 'Dept Event',
  exam: 'Examination',
  deadline: 'Deadline',
  holiday: 'Holiday',
};

const CATEGORY_COLORS: Record<AcademicEventCategory, string> = {
  event: 'bg-indigo-600 text-indigo-700',
  exam: 'bg-rose-600 text-rose-700',
  deadline: 'bg-amber-600 text-amber-700',
  holiday: 'bg-emerald-600 text-emerald-700',
};

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function AcademicCalendarCard({
  token,
  user,
  todayIsoDate,
}: AcademicCalendarCardProps) {
  const initialDate = todayIsoDate || new Date().toISOString().slice(0, 10);
  const [viewYear, setViewYear] = useState<number>(() => Number(initialDate.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState<number>(() => Number(initialDate.slice(5, 7)) - 1);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [events, setEvents] = useState<AcademicCalendarEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState(initialDate);
  const [category, setCategory] = useState<AcademicEventCategory>('event');
  const [yearOfStudy, setYearOfStudy] = useState('All Years');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAcademicCalendar(token);
      setEvents(res.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load academic calendar.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const canAdd =
    user.role === 'hod' || user.role === 'class_advisor' || user.role === 'dept_staff';
  const canDelete = user.role === 'hod' || user.role === 'class_advisor';

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !eventDate) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createAcademicCalendarEvent(token, {
        title: title.trim(),
        eventDate,
        category,
        yearOfStudy: yearOfStudy.trim() || 'All Years',
        description: description.trim(),
      });
      setTitle('');
      setDescription('');
      setShowAddForm(false);
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create calendar event.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteEvent = async (id: number) => {
    setError(null);
    try {
      await api.deleteAcademicCalendarEvent(token, id);
      setEvents((prev) => prev.filter((ev) => ev.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete calendar event.');
    }
  };

  const monthCells = useMemo(() => {
    const firstDay = new Date(Date.UTC(viewYear, viewMonth, 1));
    const startWeekday = firstDay.getUTCDay();
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const cells: { iso: string | null; day: number | null }[] = [];

    for (let i = 0; i < startWeekday; i++) {
      cells.push({ iso: null, day: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(viewMonth + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      cells.push({ iso: `${viewYear}-${mm}-${dd}`, day: d });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, AcademicCalendarEventItem[]>();
    for (const ev of events) {
      const list = map.get(ev.eventDate) ?? [];
      list.push(ev);
      map.set(ev.eventDate, list);
    }
    return map;
  }, [events]);

  const displayedEvents = useMemo(() => {
    if (selectedDate) {
      return events.filter((ev) => ev.eventDate === selectedDate);
    }
    return events;
  }, [events, selectedDate]);

  const monthTitle = new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth());
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
            <CalendarDays className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Academic Calendar</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Department events, examination schedules, submission deadlines, and holidays
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {selectedDate && (
            <button
              type="button"
              onClick={() => setSelectedDate('')}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
            >
              Show All Dates
            </button>
          )}
          {canAdd && (
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              {showAddForm ? 'Close Form' : 'Add Event'}
            </button>
          )}
        </div>
      </div>

      {showAddForm && canAdd && (
        <form
          onSubmit={handleCreateEvent}
          className="px-6 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
        >
          <div className="md:col-span-2">
            <label htmlFor="cal-title" className="block text-[11px] font-medium text-slate-700 mb-1">
              Event Title
            </label>
            <input
              id="cal-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Internal Assessment II"
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>

          <div>
            <label htmlFor="cal-date" className="block text-[11px] font-medium text-slate-700 mb-1">
              Date
            </label>
            <input
              id="cal-date"
              type="date"
              required
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white"
            />
          </div>

          <div>
            <label htmlFor="cal-category" className="block text-[11px] font-medium text-slate-700 mb-1">
              Category
            </label>
            <select
              id="cal-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as AcademicEventCategory)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="event">Dept Event</option>
              <option value="exam">Examination</option>
              <option value="deadline">Deadline</option>
              <option value="holiday">Holiday</option>
            </select>
          </div>

          <div>
            <label htmlFor="cal-cohort" className="block text-[11px] font-medium text-slate-700 mb-1">
              Cohort
            </label>
            <input
              id="cal-cohort"
              type="text"
              value={yearOfStudy}
              onChange={(e) => setYearOfStudy(e.target.value)}
              placeholder="All Years"
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>

          <div className="md:col-span-4">
            <label htmlFor="cal-desc" className="block text-[11px] font-medium text-slate-700 mb-1">
              Details (Optional)
            </label>
            <input
              id="cal-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Venue, submission portal instructions, or schedule notes"
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap"
          >
            {submitting ? 'Saving...' : 'Save Event'}
          </button>
        </form>
      )}

      {error && <div className="px-6 py-3 text-xs text-rose-700">{error}</div>}

      <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Month Grid */}
        <div className="lg:col-span-7 border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-slate-900">{monthTitle}</h4>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="p-1 text-slate-600 hover:text-slate-900 border border-slate-200 rounded"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="p-1 text-slate-600 hover:text-slate-900 border border-slate-200 rounded"
                aria-label="Next month"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-500 mb-1.5">
            {WEEKDAY_HEADERS.map((wd) => (
              <div key={wd} className="py-1">
                {wd}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {monthCells.map((cell, idx) => {
              if (!cell.iso || cell.day === null) {
                return <div key={`empty-${idx}`} className="h-14 bg-slate-50/40 rounded" />;
              }
              const dayEvents = eventsByDate.get(cell.iso) ?? [];
              const isToday = cell.iso === initialDate;
              const isSelected = cell.iso === selectedDate;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() =>
                    setSelectedDate((prev) => (prev === cell.iso ? '' : cell.iso ?? ''))
                  }
                  className={`h-14 p-1.5 border rounded text-left flex flex-col justify-between transition-colors ${
                    isSelected
                      ? 'border-indigo-700 bg-indigo-50/70'
                      : isToday
                      ? 'border-indigo-300 bg-indigo-50/30'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      isToday ? 'font-semibold text-indigo-700' : 'text-slate-700'
                    }`}
                  >
                    {cell.day}
                  </span>
                  {dayEvents.length > 0 && (
                    <div className="flex items-center gap-1 overflow-hidden">
                      {dayEvents.slice(0, 3).map((ev) => (
                        <span
                          key={ev.id}
                          className={`w-2 h-2 rounded-xs ${CATEGORY_COLORS[ev.category].split(' ')[0]}`}
                          title={ev.title}
                        />
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="font-mono text-[9px] text-slate-500">
                          +{dayEvents.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
            {(Object.keys(CATEGORY_LABELS) as AcademicEventCategory[]).map((cat) => (
              <span key={cat} className="inline-flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-xs ${CATEGORY_COLORS[cat].split(' ')[0]}`} />
                <span>{CATEGORY_LABELS[cat]}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Chronological Event List */}
        <div className="lg:col-span-5 border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-900">
              {selectedDate ? `Events on ${selectedDate}` : 'Upcoming Department Schedule'}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-slate-500">
              {displayedEvents.length} item{displayedEvents.length === 1 ? '' : 's'}
            </span>
          </div>

          {loading ? (
            <div className="p-6 text-center text-xs text-slate-500">Loading schedule...</div>
          ) : displayedEvents.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No academic calendar events scheduled for this selection.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-[340px] overflow-y-auto">
              {displayedEvents.map((ev) => (
                <div key={ev.id} className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[10px] font-mono uppercase tracking-wider font-semibold ${CATEGORY_COLORS[ev.category].split(' ')[1]}`}
                      >
                        {CATEGORY_LABELS[ev.category]}
                      </span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-600">
                        {ev.eventDate}
                      </span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="text-[11px] text-slate-500">{ev.yearOfStudy}</span>
                    </div>
                    <div className="text-xs font-semibold text-slate-900 mt-1">{ev.title}</div>
                    {ev.description && (
                      <p className="text-xs text-slate-600 mt-0.5">{ev.description}</p>
                    )}
                  </div>

                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDeleteEvent(ev.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-700 rounded shrink-0"
                      aria-label={`Delete ${ev.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
