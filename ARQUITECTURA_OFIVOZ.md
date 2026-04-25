# Arquitectura y Funcionamiento de Ofivoz

¡Felicidades por completar el MVP (Producto Viable Mínimo) de Ofivoz! 
Este documento sirve como tu mapa técnico para entender exactamente cómo funciona el ecosistema que hemos construido, cómo se conectan las piezas, y cómo mantenerlo vivo en la nube.

---

## 1. El Ecosistema Integral (Cómo se conecta todo)
Ofivoz no es una página web tradicional. Es una **Aplicación en Tiempo Real (Real-Time App)**. Funciona dividiendo sus responsabilidades en tres capas fundamentales que colaboran a la velocidad de la luz:

1. **La Cara (Frontend - Pantalla Web)**
2. **El Cerebro (Backend - Servidor Node.js)**
3. **El Músculo de Audio (LiveKit WebRTC)**

A continuación, desglosemos cada una.

---

## 2. Los Componentes del Código
### `/public` (El Frontend)
Dentro de la carpeta `public/` residen `index.html`, `index.css` y `renderer.js`. 
* Esta es la interfaz que los usuarios ven y tocan. 
* En lugar de descargar audio como si fuera un video de YouTube, `renderer.js` ejecuta la magia matemática en tiempo real para silenciar (`track.setVolume(0)`) a ciertas personas y simular sub-salas usando la tecnología nativa del navegador. Todo el aislamiento acústico y los toques de puerta (Toc Toc) viven en la memoria de la computadora de cada persona independiente de las demás.

### `server.js` (El Cerebro de Señalización)
Este es tu verdadero servidor. Escrito en **Node.js**, su trabajo principal **NO es procesar audio**, sino actuar como un centro de control o un "Policía de tráfico" (WebSocket). 
* Si la computadora de Diana hace clic en un Grito, la computadora de Diana le envía un mini-mensaje de texto a `server.js` diciendo `{"type": "grito_start", "from": "Diana"}`.
* El `server.js` repite este mensaje a la velocidad de la luz a todos los demás computadores conectados para que sus respectivos navegadores apaguen sus parlantes.
* Además, el servidor es el único autorizado para generar las *"Llaves Mágicas"* cifradas (Tokens JWT) que un usuario necesita para acceder a la red de audio principal.

### LiveKit (El Músculo del Audio)
LiveKit es un servicio de infraestructura WebRTC ultra-rápida. 
A través de las variables de entorno (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, etc.), tu código se conecta a los servidores mundiales de LiveKit.
* Por el servidor de LiveKit es por donde viaja la **voz** física pesada. 
* Ofivoz delega inteligentemente el tráfico masivo de megabytes de audio a los servidores de LiveKit, lo que permite que tu aplicación web sea barata (o gratis) de hospedar, ya que no ahogas tus propios servidores con datos de voz.

---

## 3. Infraestructura en la Nube (GitHub y Render)

Toda la aplicación de software existe en 3 lugares distintos físicamente: tu Mac, el almacén (Github) y el servidor activo (Render).

### ¿Qué es Github?
Piensa en GitHub como el "Google Drive" pero diseñado exclusivamente para código fuente. 
Es una bóveda de control de versiones. Cada vez que hacemos un cambio en nuestra Mac y le damos a `Commit and Push` en **GitHub Desktop**, estamos enviando un paquete comprimido con el nuevo código a esa bóveda.
* GitHub **NO** ejecuta la página. Solamente almacena los archivos estáticos de forma segura.

### ¿Qué es Render.com?
Render es el Hospedador en la Nube (Cloud Hosting o VPS Platform). 
Mientras que Firebase Hosting solo sirve para páginas inertes, Render es capaz de alquilarte una Computadora Virtual en Norteamérica corriendo 24/7.
1. Render está "casado" con GitHub. 
2. Cuando subes archivos a GitHub, Render recibe una alerta silenciosa (Webhook).
3. Automáticamente Render levanta una minicomputadora, descarga de GitHub el último código que subimos, ejecuta la instalación (`npm install`) y finalmente enciende tu aplicación (`npm start` o `node server.js`).
4. Tras lograrlo con éxito, asigna esa computadora a tu URL abierta (`ofivoz.onrender.com`), exponiendo tu aplicación para que cualquier persona con un celular pueda unirse.

---

## 4. El Flujo de Trabajo (Para futuras mejoras)
Cuando quieras mejorar la Experiencia de Usuario (UX) de Ofivoz en el futuro, el ciclo es inquebrantable:

1. **Editar Local:** Editas los archivos `.js` o `.html` en tu carpeta `/CROMATISO/Ofivoz`.
2. **Probar Local (Opcional):** Corres `node server.js` en tu terminal para ver que nada estalló en tu Mac.
3. **Guardar en la Bóveda:** Abres **GitHub Desktop**, introduces un nombre para los cambios (Commit) y aprietas *Push to origin*.
4. **Despliegue Automático:** Esperas 60 segundos. Render absorbe los cambios y actualiza automáticamente a todos los usuarios del planeta.

---
*Hecho por el equipo de Anthropic / CROMATISO - 2026*
