const express = require('express');
const cors = require('cors');
require('dotenv').config();

const parquimetrosRoutes = require('./routes/parquimetros');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta principal - Info del servicio
app.get('/', (req, res) => {
  res.json({
    servicio: 'API de Parquímetros',
    version: '1.0.0',
    estado: 'activo',
    endpoints: {
      verificar: 'GET /api/parquimetros/verificar/:placa',
      registrar: 'POST /api/parquimetros/pagar',
      historial: 'GET /api/parquimetros/historial/:placa',
      activos: 'GET /api/parquimetros/activos',
      zonas: 'GET /api/parquimetros/zonas',
    },
  });
});

// Rutas
app.use('/api/parquimetros', parquimetrosRoutes);

// Manejo de errores
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ success: false, error: err.message });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🅿️ API de Parquímetros corriendo en puerto ${PORT}`);
});