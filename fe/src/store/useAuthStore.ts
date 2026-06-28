"use client";

import { redirectBasedOnRole } from "@/lib/roleRedirect";
import { authServices } from "@/services/auth.services";
import { useLoadingStore } from "@/store/useLoadingStore";
import { useToastStore } from "@/store/useToastStore";
import { LoginPayload } from "@/types/auth.type";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type UserInfo = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type Action = {
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
  setHydrated: () => void;
  redirectBasedOnRole: (role: string) => void;
};

type AuthState = {
  userDetails: UserInfo | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
};

const initialState: AuthState = {
  userDetails: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  isHydrated: false
};

export const useAuthStore = create(
  persist<AuthState & Action>(
    (set, get) => ({
      ...initialState,
      login: async (payload: LoginPayload) => {
        const { showLoading, hideLoading } = useLoadingStore.getState();
        const { showToastError } = useToastStore.getState();
        showLoading();
        try {
          const res = await authServices.login(payload);
          set({
            userDetails: res.user,
            accessToken: res.access_token,
            refreshToken: res.refresh_token,
            isAuthenticated: true,
            isHydrated: true
          });
          // Điều hướng ngay sau khi đăng nhập thành công
          if (res.user && res.user.role) {
            window.history.replaceState({ fromRedirect: true }, ""); // Đánh dấu redirect ban đầu
            get().redirectBasedOnRole(res.user.role);
          }
        } catch (err: unknown) {
          set({
            isAuthenticated: false,
            userDetails: null,
            accessToken: null,
            refreshToken: null
          });
          if (err instanceof Error) {
            showToastError(err.message || "Login failed");
            throw err;
          } else {
            showToastError("Login failed");
            throw new Error("Login failed");
          }
        } finally {
          hideLoading();
        }
      },
      logout: async () => {
        set({
          isAuthenticated: false,
          userDetails: null,
          accessToken: null,
          refreshToken: null
        });
        if (typeof window !== "undefined") {
          const baseUrl = window.location.origin;
          window.location.href = `${baseUrl}/login`;
        }
      },
      fetchUser: async () => {
        return;
      },
      setHydrated: () => {
        set({ isHydrated: true });
      },
      redirectBasedOnRole: (role: string) => {
        redirectBasedOnRole(role);
      }
    }),
    {
      name: "auth-storage"
    }
  )
);
