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

    // Don't create Audio yet
    this.audio = null;
  }

  _playSound() {
    if (typeof window === "undefined") return; // safety check
    if (!this.audio) this.audio = new Audio("/notification.mp3");
    this.audio.play().catch(err => console.error("Audio play failed:", err));
  }

  connect(userRole) {
    if (userRole !== "superadmin") return;

    this.userRole = userRole;

    // Always fetch even if WS not connected yet
    if (!ws) this.fetch();

    if (ws && isConnected) return;

    let wsUrl;
    try {
      const url = new URL(this.API_URL);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/notifications/ws";
      wsUrl = url.toString();
    } catch (e) {
      console.error("Invalid WebSocket URL:", e);
      return;
    }

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

        // Use lazy-play method
        this._playSound();

        // Notify subscribers
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
