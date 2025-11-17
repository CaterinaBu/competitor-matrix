import React, { useEffect, useState } from "react";

const STORAGE_KEY = "cmatrix_auth_ok";
const PASSWORD = import.meta.env.VITE_APP_PASSWORD as string | undefined;

type PasswordGateProps = {
  children: React.ReactNode;
};

export const PasswordGate: React.FC<PasswordGateProps> = ({ children }) => {
  const [authorized, setAuthorized] = useState(false);
  const [checkedStorage, setCheckedStorage] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "1") {
        setAuthorized(true);
      }
    } catch {
      // localStorage может быть недоступен в приватном режиме – тогда просто игнорируем
    } finally {
      setCheckedStorage(true);
    }
  }, []);

  if (!PASSWORD) {
    // если забыли задать пароль в .env — показываем всё как есть
    return <>{children}</>;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === PASSWORD) {
      setAuthorized(true);
      setError(null);
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // ок, без запоминания
      }
    } else {
      setError("Неверный пароль");
    }
  };

  if (!checkedStorage) {
    // можно показать спиннер, но можно и просто пустышку
    return null;
  }

  if (authorized) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white shadow-lg rounded-2xl p-6 w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-4 text-center">
          Вход в матрицу
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1" htmlFor="password">
              Пароль
            </label>
            <input
              id="password"
              type="password"
              className="w-full border rounded-md px-3 py-2 outline-none focus:ring focus:ring-blue-200"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
          </div>
          {error && (
            <div className="text-sm text-red-600">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="w-full rounded-md px-3 py-2 font-medium bg-blue-600 text-white hover:bg-blue-700 transition"
          >
            Войти
          </button>
        </form>
      </div>
    </div>
  );
};
