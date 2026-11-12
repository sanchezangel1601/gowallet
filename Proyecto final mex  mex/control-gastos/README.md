# Control Inteligente de Gastos (PWA)

Proyecto integrador – Aplicaciones Web Progresivas (UTM). Registro de ingresos y egresos, gráfico por categoría,
presupuesto mensual con alertas, almacenamiento en IndexedDB, funcionamiento offline y sincronización. La interfaz
organiza Inicio, Movimientos, Nuevo, Presupuesto y Ajustes mediante navegación adaptable a móvil y escritorio. La
aplicación instalada en un teléfono muestra el loader de GoWallet durante medio segundo; en navegador y escritorio no aparece.

## Protección de datos
En el primer inicio registra un perfil local y crea una contraseña de al menos 10 caracteres. El correo y el nombre de
usuario solo identifican el perfil en este dispositivo; no hay cuentas de servidor ni sincronización entre dispositivos.
Los movimientos, ajustes y perfil se cifran localmente con AES-GCM; la clave se deriva con PBKDF2 y no se guarda. Los
datos de instalaciones anteriores se migran al almacén cifrado y se limpian de los almacenes antiguos. GoWallet conserva
automáticamente una copia cifrada de la versión anterior en el almacenamiento local y permite restaurarla desde Ajustes.
Esta copia permanece en el mismo navegador y dispositivo; no protege contra borrar los datos del navegador o perder el
dispositivo. Para transferir datos, descarga un respaldo cifrado y requiere la misma contraseña para importarlo. El
acceso es local; no se incluyen proveedores de autenticación externa ni recuperación de contraseña.

La contraseña no se puede recuperar. Guarda una copia cifrada en un lugar seguro y recuerda su contraseña. Para
cifrar datos existentes durante la migración, cierra otras pestañas abiertas de la aplicación.

## Ejecutar localmente
Un Service Worker requiere `localhost` o HTTPS:
```
cd control-gastos
python3 -m http.server 8080      # o: npx serve .
```
Abrir http://localhost:8080

## Publicar con HTTPS (elige una)
- **GitHub Pages:** sube la carpeta a un repo → Settings → Pages → Branch `main` / root.
- **Netlify / Vercel / Firebase Hosting:** arrastra la carpeta; HTTPS viene incluido.

## Cumplimiento de requisitos
| # | Requisito | Dónde |
|---|-----------|-------|
| 1 | Responsivo | `css/styles.css` (grid, media query modo oscuro) |
| 2 | Manifest + instalable | `manifest.webmanifest`, botón "Instalar" |
| 3 | Service Worker offline | `sw.js` (cache del app shell) |
| 4 | API REST | `open.er-api.com` (tipo de cambio MXN→USD) en `js/app.js` |
| 5 | 2+ APIs del dispositivo | Notificaciones (`showNotification`) y Web Share |
| 6 | IndexedDB | `js/db.js` |
| 7 | CRUD | Crear / listar / editar / eliminar movimientos |
| 8 | Errores, validación, protección | Validación de entradas e importaciones, errores visibles, CSP, `textContent` y datos/backups cifrados con AES-GCM en IndexedDB |
| 9 | HTTPS | Hosting en la nube (ver arriba) |
| 10 | Pruebas + Lighthouse | Informes en `evidencias/lighthouse-desktop.report.html` y `evidencias/lighthouse-mobile.report.html`; completar las pruebas en dispositivos físicos indicadas abajo |

## Pruebas y evidencias
Los informes Lighthouse adjuntos corresponden a emulación de escritorio y móvil en localhost. Lighthouse 13 ya no
incluye una categoría PWA; revisa Manifest y Service Worker por separado en DevTools → Application. La emulación no
sustituye las capturas requeridas en dos dispositivos/plataformas reales.

1. Abrir la aplicación instalada en un teléfono Android y en un segundo dispositivo/plataforma (por ejemplo iOS).
   Capturar el inicio GoWallet, la instalación y una operación CRUD en cada uno.
2. En DevTools → Application, capturar Manifest, Service Worker e IndexedDB.
3. En Network → Offline, recargar y probar crear, editar y eliminar un movimiento; después volver a conectarse.
4. Probar una contraseña incorrecta, una correcta, la validación del formulario y exportar/importar un respaldo cifrado.
5. Ejecutar Lighthouse para Performance, Accessibility, Best Practices y SEO en ambos dispositivos y guardar los reportes.
   Los informes locales actuales sirven como evidencia de laboratorio, no como prueba de hardware físico.

## Entregables que debes completar tú
Documento técnico (portada, problemática, objetivos, arquitectura, tecnologías, evidencias), enlace público,
video de 5 min y defensa. Al actualizar recursos, cambia la versión en `sw.js` y los parámetros `v=` de CSS/JS en
`index.html`, `js/app.js` y `sw.js` para invalidar la caché.
