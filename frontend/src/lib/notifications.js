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
  }

  // Subscribe to notification updates
  subscribe(callback) {
    this.subscribers.push(callback);
    callback(this.notifications); // initial call
    return () => {
      this.subscribers = this.subscribers.filter((cb) => cb !== callback);
    };
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
      this.notifications = data.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
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

    this.userRole = userRole;

    if (ws && isConnected) return; // prevent multiple WS

    let wsUrl = this.API_URL.startsWith("https")
      ? this.API_URL.replace("https", "wss") + "/notifications/ws"
      : this.API_URL.replace("http", "ws") + "/notifications/ws";

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("Notifications WS connected");
      isConnected = true;
      if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout);
    };

    ws.onmessage = (event) => {
      try {
        const newNotif = JSON.parse(event.data);
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
