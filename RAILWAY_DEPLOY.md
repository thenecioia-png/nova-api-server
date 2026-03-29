# Despliegue en Railway — N.O.V.A. API Server

## Variables de entorno necesarias en Railway

| Variable | Valor |
|----------|-------|
| `OPENAI_API_KEY` | Tu key de OpenAI (sk-proj-...) |
| `DATABASE_URL` | Lo da Railway automáticamente al agregar PostgreSQL |
| `PORT` | Lo da Railway automáticamente |
| `BOT_SECRET_KEY` | El mismo que tienes configurado ahora |
| `FRONTEND_URL` | URL de tu frontend (en Vercel o Replit) |

## Pasos para desplegar

### 1. Crea cuenta en Railway
Ve a https://railway.app → Sign up con Google o GitHub (gratis)

### 2. Instala Railway CLI
```
npm install -g @railway/cli
```

### 3. Login
```
railway login
```

### 4. Inicializa el proyecto (en la carpeta del proyecto)
```
railway init
```
Dale un nombre: `nova-api-server`

### 5. Agrega PostgreSQL
En el dashboard de Railway → New Service → Database → PostgreSQL
Copia el DATABASE_URL que te da

### 6. Configura variables de entorno en Railway
En el dashboard → Variables:
- OPENAI_API_KEY = tu_key
- DATABASE_URL = lo que copiaste del paso 5

### 7. Despliega
```
railway up
```

### 8. Actualiza la URL del bot
En nova_bot.py, cambia:
```python
BASE_URL = "https://tu-proyecto.railway.app"
```

## Resultado
- Sin límite de 5 minutos
- N.O.V.A. puede trabajar horas sin parar
- Costo Railway: ~$5/mes plan básico o gratis con $5 de crédito
