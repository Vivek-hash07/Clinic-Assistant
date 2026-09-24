"use client";

import { useEffect, useState } from "react";
import { DOCTOR_PROFILES, type DoctorProfile } from "@/lib/agent/clinic";

type Slot = { datetime: string; displayTime: string };

type Visit = {
  id: string;
  doctor: string;
  displayTime: string;
  status: string;
  reason: string;
};

type BookingDialogProps = {
  open: boolean;
  onClose: () => void;
  onBooked: (summary: string) => void;
};

export function BookingDialog({ open, onClose, onBooked }: BookingDialogProps) {
  const [tab, setTab] = useState<"book" | "visits">("book");
  const [doctor, setDoctor] = useState<DoctorProfile | null>(null);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState("");
  const [reason, setReason] = useState("");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [loadingVisits, setLoadingVisits] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || tab !== "visits") return;
    let cancelled = false;
    setLoadingVisits(true);
    setNotice(null);
    void fetch("/api/appointments")
      .then(async (response) => {
        const payload = (await response.json()) as {
          ok?: boolean;
          summary?: string;
          data?: { appointments?: Visit[] };
        };
        if (cancelled) return;
        if (!response.ok || !payload.ok) {
          setNotice(payload.summary || "Could not load your appointments.");
          setVisits([]);
          return;
        }
        setVisits(payload.data?.appointments ?? []);
      })
      .catch(() => {
        if (!cancelled) setNotice("Could not load your appointments.");
      })
      .finally(() => {
        if (!cancelled) setLoadingVisits(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (!doctor || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) {
      setSlots([]);
      setSlot("");
      setLoadingSlots(false);
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    setSlot("");
    setNotice(null);
    const params = new URLSearchParams({ doctor: doctor.name, date });
    void fetch(`/api/appointments?${params.toString()}`)
      .then(async (response) => {
        const payload = (await response.json()) as {
          ok?: boolean;
          summary?: string;
          data?: { slots?: Slot[] };
        };
        if (cancelled) return;
        if (!response.ok || !payload.ok) {
          setSlots([]);
          setNotice(payload.summary || "No open times for that day.");
          return;
        }
        const next = payload.data?.slots ?? [];
        setSlots(next);
        if (next.length === 0) setNotice("No open times on that weekday.");
      })
      .catch(() => {
        if (!cancelled) setNotice("Could not load open times.");
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doctor, date]);

  if (!open) return null;

  async function book() {
    if (!doctor || !slot || reason.trim().length < 2 || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor: doctor.name, datetime: slot, reason: reason.trim() }),
      });
      const payload = (await response.json()) as { ok?: boolean; summary?: string };
      if (!response.ok || !payload.ok) {
        setNotice(payload.summary || "That time could not be booked.");
        return;
      }
      onBooked(payload.summary || "Appointment booked.");
      setDoctor(null);
      setDate("");
      setReason("");
      setSlot("");
      onClose();
    } catch {
      setNotice("That time could not be booked.");
    } finally {
      setSaving(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-title"
        className="flex max-h-[min(40rem,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-zinc-950"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 id="booking-title" className="text-lg font-semibold tracking-tight">
            Appointments
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Close
          </button>
        </div>
        <div className="mt-3 flex gap-2 px-5">
          <button
            type="button"
            onClick={() => setTab("book")}
            className={`rounded-full px-3 py-1.5 text-sm ${
              tab === "book"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            }`}
          >
            Book
          </button>
          <button
            type="button"
            onClick={() => setTab("visits")}
            className={`rounded-full px-3 py-1.5 text-sm ${
              tab === "visits"
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
            }`}
          >
            My appointments
          </button>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto px-5 pb-5">
          {notice ? <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">{notice}</p> : null}

          {tab === "visits" ? (
            loadingVisits ? (
              <p className="text-sm text-zinc-500">Loading your chart…</p>
            ) : visits.length === 0 ? (
              <p className="text-sm text-zinc-500">No appointments are on your chart.</p>
            ) : (
              <ul className="space-y-2">
                {visits.map((visit) => (
                  <li
                    key={visit.id}
                    className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900"
                  >
                    <p className="font-medium">{visit.doctor}</p>
                    <p className="mt-1 text-zinc-600 dark:text-zinc-300">
                      {visit.displayTime} · {visit.reason}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
                      {visit.status}
                    </p>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="space-y-4">
              <ul className="grid gap-2">
                {DOCTOR_PROFILES.map((profile) => {
                  const selected = doctor?.name === profile.name;
                  return (
                    <li key={profile.name}>
                      <button
                        type="button"
                        onClick={() => {
                          setDoctor(profile);
                          setNotice(null);
                        }}
                        className={`w-full rounded-2xl px-4 py-3 text-left ${
                          selected
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                            : "bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                        }`}
                      >
                        <span className="block text-sm font-medium">{profile.name}</span>
                        <span
                          className={`mt-1 block text-xs ${selected ? "opacity-80" : "text-zinc-500"}`}
                        >
                          {profile.specialty} · {profile.focus}
                        </span>
                        <span
                          className={`mt-2 block text-sm leading-6 ${selected ? "opacity-90" : "text-zinc-600 dark:text-zinc-300"}`}
                        >
                          {profile.about}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {doctor ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void book();
                  }}
                >
                  <label className="block text-sm font-medium" htmlFor="visit-date">
                    Date (UTC weekday)
                  </label>
                  <input
                    id="visit-date"
                    type="date"
                    min={today}
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                  />
                  <p className="text-sm font-medium">Time</p>
                  {loadingSlots ? (
                    <p className="text-sm text-zinc-500">Looking up open times…</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {slots.map((item) => (
                        <button
                          key={item.datetime}
                          type="button"
                          onClick={() => setSlot(item.datetime)}
                          className={`rounded-full px-3 py-1.5 text-xs ${
                            slot === item.datetime
                              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                              : "bg-zinc-100 dark:bg-zinc-900"
                          }`}
                        >
                          {item.displayTime.replace(/ UTC$/, "")}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="block text-sm font-medium" htmlFor="visit-reason">
                    Reason
                  </label>
                  <input
                    id="visit-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Headache"
                    className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                  />
                  <button
                    type="submit"
                    disabled={!slot || reason.trim().length < 2 || saving}
                    className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    {saving ? "Booking…" : "Book appointment"}
                  </button>
                </form>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
