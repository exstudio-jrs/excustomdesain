
const NOTIFICATION_LIMIT = 30;

export function initNotifications(supabase, userId) {
  const root = document.querySelector("#notificationRoot");
  const toggle = document.querySelector("#notificationToggle");
  const panel = document.querySelector("#notificationPanel");
  const badge = document.querySelector("#notificationBadge");
  const list = document.querySelector("#notificationList");
  const unreadText = document.querySelector("#notificationUnreadText");
  const markAll = document.querySelector("#notificationMarkAll");

  if (!root || !toggle || !panel || !badge || !list || !userId) {
    console.warn("Elemen notifikasi belum lengkap.");
    return;
  }

  let notifications = [];
  let unreadCount = 0;
  let channel = null;

  function escape(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function formatTime(value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function getTarget(notification) {
    const id = encodeURIComponent(notification.entity_id || "");

    switch (notification.entity_type) {
      case "design":
        return id ? `dashboard.html?design_id=${id}` : "dashboard.html";

      case "purchase_order":
        return id ? `po.html?id=${id}` : "po.html";

      case "nota":
        return id ? `nota.html?id=${id}` : "nota.html";

      default:
        return "dashboard.html";
    }
  }

  function updateBadge() {
    badge.textContent = unreadCount > 99 ? "99+" : unreadCount;
    badge.classList.toggle("hidden", unreadCount === 0);

    unreadText.textContent = unreadCount
      ? `${unreadCount} notifikasi belum dibaca`
      : "Tidak ada notifikasi baru";

    markAll.disabled = unreadCount === 0;
  }

  function render() {
    updateBadge();

    if (!notifications.length) {
      list.innerHTML = `
        <div class="notification-empty">
          <span>♧</span>
          <p>Belum ada notifikasi.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = notifications.map(item => `
      <a
        class="notification-item ${item.is_read ? "" : "unread"}"
        href="${escape(getTarget(item))}"
        data-notification-id="${escape(item.id)}"
      >
        <span class="notification-item-dot"></span>

        <span class="notification-item-content">
          <strong>${escape(item.title)}</strong>
          <span>${escape(item.message)}</span>
          <small>${escape(formatTime(item.created_at))}</small>
        </span>
      </a>
    `).join("");
  }

  async function loadNotifications() {
    list.innerHTML = `
      <p class="notification-loading">Memuat notifikasi...</p>
    `;

    try {
      const [notificationResult, countResult] = await Promise.all([
        supabase
          .from("notifications")
          .select("id, user_id, actor_id, event_type, title, message, entity_type, entity_id, is_read, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(NOTIFICATION_LIMIT),

        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("is_read", false)
      ]);

      if (notificationResult.error) throw notificationResult.error;
      if (countResult.error) throw countResult.error;

      notifications = notificationResult.data || [];
      unreadCount = countResult.count || 0;

      render();

    } catch (error) {
      console.error("Gagal memuat notifikasi:", error);

      list.innerHTML = `
        <p class="notification-error">
          Gagal memuat notifikasi. Silakan coba lagi.
        </p>
      `;
    }
  }

  async function markAsRead(id) {
    const item = notifications.find(n => n.id === id);

    if (!item || item.is_read) return;

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("Gagal menandai notifikasi:", error);
      return;
    }

    item.is_read = true;
    unreadCount = Math.max(0, unreadCount - 1);
    render();
  }

  async function markAllAsRead() {
    if (!unreadCount) return;

    markAll.disabled = true;

    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    if (error) {
      console.error("Gagal menandai semua notifikasi:", error);
      markAll.disabled = false;
      return;
    }

    notifications.forEach(item => {
      item.is_read = true;
    });

    unreadCount = 0;
    render();
  }

  toggle.addEventListener("click", async () => {
    const isOpen = !panel.classList.contains("hidden");

    panel.classList.toggle("hidden", isOpen);
    toggle.setAttribute("aria-expanded", String(!isOpen));

    if (!isOpen) {
      await loadNotifications();
    }
  });

  markAll.addEventListener("click", markAllAsRead);

  list.addEventListener("click", async event => {
  const item = event.target.closest("[data-notification-id]");

  if (!item) return;

  event.preventDefault();

  const id = item.dataset.notificationId;
  const targetUrl = item.href;

  await markAsRead(id);

  window.location.href = targetUrl;
});

  document.addEventListener("click", event => {
    if (!root.contains(event.target)) {
      panel.classList.add("hidden");
      toggle.setAttribute("aria-expanded", "false");
    }
  });

  // Pembaruan notifikasi secara realtime.
  channel = supabase
    .channel(`notifications-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`
      },
      () => {
        loadNotifications();
      }
    )
    .subscribe(status => {
      console.log("Status realtime notifikasi:", status);
    });

  // Muat data awal.
  loadNotifications();

  // Fungsi pembersihan jika halaman perlu dilepas.
  return function cleanupNotifications() {
    if (channel) {
      supabase.removeChannel(channel);
    }
  };
}
