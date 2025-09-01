"use client";

import React, { useState, useEffect } from "react";
import { AuroraBackground } from "@/components/ui/aurora-background";
import Footer from "@/components/layouts/Footer";
import Header from "@/components/layouts/Header";
import { Camera } from "lucide-react";

export default function ProfilePage() {
  const [user, setUser] = useState(null);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [notification, setNotification] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("user");
    if (saved) {
      const data = JSON.parse(saved);
      setUser(data);
      setName(data.name);
      setAvatar(data.picture);
    }
  }, []);

  const showNotification = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(""), 3000);
  };

  const handleSubmit = () => {
    const updatedUser = { ...user, name, picture: avatar };
    setUser(updatedUser);
    localStorage.setItem("user", JSON.stringify(updatedUser));
    showNotification("Profile updated successfully!");
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setAvatar(reader.result);
    reader.readAsDataURL(file);
  };

  const handleRemoveAvatar = () => setAvatar(null);

  if (!user) {
    return (
      <>
        <Header />
        <AuroraBackground>
          <div className="p-6 text-center mt-24">
            <h2 className="text-xl font-semibold">Not Logged In</h2>
            <p>Please login to view your profile.</p>
          </div>
        </AuroraBackground>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <AuroraBackground>
        <div className="p-6 max-w-2xl mx-auto mt-24 text-center">
          {/* Center-aligned Manage Profile heading */}
          <h1 className="text-2xl font-bold mb-6">Manage Profile</h1>

          {/* Avatar Section */}
          <div className="relative w-28 h-28 mx-auto mb-6">
            <img
              src={avatar || "/default-avatar.png"}
              alt="avatar"
              className="w-28 h-28 rounded-full border object-cover"
            />
            {/* Camera icon overlay for changing image */}
            <label className="absolute bottom-0 right-0 bg-white rounded-full p-2 cursor-pointer shadow-md hover:bg-gray-100">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <Camera className="w-5 h-5 text-gray-700" />
            </label>
          </div>

          {/* Name Field */}
          <div className="mb-4 text-left">
            <label className="block mb-1 font-semibold">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border px-3 py-2 rounded-md"
              placeholder="Enter your name"
            />
          </div>

          {/* Email Field */}
          <div className="mb-4 text-left">
            <label className="block mb-1 font-semibold">Email</label>
            <input
              type="text"
              value={user.email}
              disabled
              className="w-full border px-3 py-2 rounded-md bg-gray-100"
            />
          </div>

          {/* Role Field */}
          <div className="mb-4 text-left">
            <label className="block mb-1 font-semibold">Role</label>
            <input
              type="text"
              value={user.role || "User"}
              disabled
              className="w-full border px-3 py-2 rounded-md bg-gray-100"
            />
          </div>

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            className="bg-green-500 text-white px-6 py-2 rounded-md hover:bg-green-600"
          >
            Submit
          </button>

          {/* Notification */}
          {notification && (
            <div className="mt-4 text-center text-white bg-green-500 px-4 py-2 rounded-md animate-pulse">
              {notification}
            </div>
          )}
        </div>
      </AuroraBackground>
      <Footer />
    </>
  );
}
