"use client";

let ws = null;
let wsReconnectTimeout = null;
let isConnected = false;

export class NotificationsService {
  constructor(apiUrl) {
    this.API_URL = apiUrl || (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000");
    this.notifications = [];
    this.subscribers = [];
    this.userRole = null;

    // AudioContext lazy init
    this.audioCtx = null;
  }

  // ----- Web Audio API: No autoplay block, no user click required -----
  _playSound() {
    try {
      if (typeof window === "undefined") return;

      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }

      const duration = 0.2;
      const oscillator = this.audioCtx.createOscillator();
      const gainNode = this.audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioCtx.destination);

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, this.audioCtx.currentTime);

      gainNode.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        this.audioCtx.currentTime + duration
      );

      oscillator.start();
      oscillator.stop(this.audioCtx.currentTime + duration);
    } catch (err) {
      console.error("Sound playback error:", err);
    }
  }

  static formatDateTime(ts) {
    if (!ts) return "";

    ts = ts.replace("T", " ");
    const [date, time] = ts.split(" ");

    const parts = date.split("-");
    let yyyy, mm, dd;
    parts[0].length === 2 ? ([dd, mm, yyyy] = parts) : ([yyyy, mm, dd] = parts);

    const [hh, mins] = time.split(":");
    let h = parseInt(hh);
    const suffix = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;

    return `${dd}-${mm}-${yyyy} ${h}:${mins} ${suffix}`;
  }

  // Subscribe to notification updates
  subscribe(callback) {
    this.subscribers.push(callback);
    callback(this.notifications);
    return () => (this.subscribers = this.subscribers.filter((cb) => cb !== callback));
  }

  _notifySubscribers() {
    this.subscribers.forEach((cb) => cb(this.notifications));
  }

  // Fetch notifications from backend
  async fetch() {
    try {
      const res = await fetch(`${this.API_URL}/notifications`);
      const data = await res.json();

      // Sort by timestamp descending
      this.notifications = data
        .map((n) => ({ ...n, formattedTime: NotificationsService.formatDateTime(n.timestamp) }))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      this._notifySubscribers();
    } catch (e) {
      console.error("Error fetching notifications:", e);
    }
  }

  // Optimistic mark as read
  async markAsRead(id) {
    const prev = [...this.notifications];
    this.notifications = this.notifications.map((n) =>
      n._id === id ? { ...n, status: "read" } : n
    );
    this._notifySubscribers();

    try {
      await fetch(`${this.API_URL}/notifications/read/${id}`, { method: "POST" });
    } catch (e) {
      console.error("Failed to mark as read, rolling back:", e);
      this.notifications = prev;
      this._notifySubscribers();
    }
  }

  async markAllAsRead() {
    const prev = [...this.notifications];
    this.notifications = this.notifications.map((n) => ({ ...n, status: "read" }));
    this._notifySubscribers();

    try {
      await fetch(`${this.API_URL}/notifications/read-all`, { method: "POST" });
    } catch (e) {
      console.error("Failed to mark all as read, rolling back:", e);
      this.notifications = prev;
      this._notifySubscribers();
    }
  }

  // Initialize WebSocket connection
  connect(userRole) {
    if (userRole !== "superadmin") return;
    if (ws && isConnected) return;

    const wsUrl = this.API_URL.startsWith("https")
      ? this.API_URL.replace("https", "wss") + "/notifications/ws"
      : this.API_URL.replace("http", "ws") + "/notifications/ws";

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("Notifications WS connected");
      isConnected = true;
      if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout);
      this.fetch();
    };

    ws.onmessage = (event) => {
      try {
        const newNotif = JSON.parse(event.data);
        newNotif.formattedTime = NotificationsService.formatDateTime(newNotif.timestamp);

        this.notifications = [newNotif, ...this.notifications];
        this._notifySubscribers();
      } catch (e) {
        console.error("Invalid WS message:", e);
      }
    };

    ws.onerror = (err) => console.error("WS error:", err);

    ws.onclose = () => {
      console.log("Notifications WS disconnected, retrying in 3s...");
      isConnected = false;
      wsReconnectTimeout = setTimeout(() => this.connect(userRole), 3000);
    };
  }

  disconnect() {
    if (ws) {
      ws.close();
      ws = null;
      isConnected = false;
      if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout);
    }
  }
}

// Singleton instance
let instance = null;

export const getNotificationsService = (apiUrl) => {
  if (!instance) instance = new NotificationsService(apiUrl);
  return instance;
};
