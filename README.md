# Sales Tracker

App de seguimiento de prospectos para equipos de ventas.  
Stack: React + Vite + Firebase Firestore + Vercel

---

## 🚀 Setup en 4 pasos

### 1. Crear proyecto en Firebase

1. Ve a [console.firebase.google.com](https://console.firebase.google.com)
2. Clic en **"Agregar proyecto"** → pon un nombre (ej. `sales-tracker`)
3. Desactiva Google Analytics (opcional) → **Crear proyecto**
4. Una vez creado: **"</> Web"** → registra la app → copia el objeto `firebaseConfig`

### 2. Activar Firestore

1. En el menú izquierdo: **Build → Firestore Database**
2. Clic **"Crear base de datos"**
3. Elige **"Iniciar en modo de prueba"** (por ahora)
4. Selecciona una región (ej. `us-central1`) → **Listo**

### 3. Variables de entorno

Crea un archivo `.env.local` en la raíz del proyecto:

```env
VITE_FIREBASE_API_KEY=tu_api_key
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu-proyecto-id
VITE_FIREBASE_STORAGE_BUCKET=tu-proyecto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

> ⚠️ **Nunca subas `.env.local` a GitHub** — ya está en `.gitignore`

### 4. Instalar y correr localmente

```bash
npm install
npm run dev
```

---

## ☁️ Deploy en Vercel

1. Sube el proyecto a GitHub
2. En [vercel.com](https://vercel.com): **"Add New Project"** → importa el repo
3. **Importante**: antes de hacer deploy, agrega las variables de entorno:
   - Ve a **Settings → Environment Variables**
   - Agrega cada `VITE_FIREBASE_*` con su valor correspondiente
4. Clic **Deploy** — listo ✓

---

## 🔒 Reglas de seguridad Firestore (recomendado)

Una vez que tengas usuarios reales, cambia las reglas en Firebase Console → Firestore → Rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /prospects/{document} {
      allow read, write: if true; // Cambiar cuando agregues autenticación
    }
  }
}
```

---

## 📁 Estructura del proyecto

```
sales-tracker/
├── src/
│   ├── App.jsx          # App principal
│   ├── firebase.js      # Config Firebase
│   └── main.jsx         # Entry point
├── index.html
├── vite.config.js
├── package.json
├── .env.example         # Plantilla de variables
└── .gitignore
```

---

## ✨ Features

- **Dashboard** — KPIs, embudo, ranking por vendedor, últimos movimientos
- **Prospectos** — Agregar, editar, filtrar, buscar por etapa/vendedor
- **Reporte** — Vista por vendedor con progreso de meta + **exportar a imagen PNG**
- **Firebase Realtime** — todos en el equipo ven cambios en tiempo real
- **Offline support** — funciona sin internet, sincroniza al reconectar
