const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// ============================================
// Función auxiliar para calcular tiempo
// ============================================
const calcularTiempo = (minutos) => {
  if (minutos < 60) {
    return `${minutos} minutos`;
  }
  const horas = Math.floor(minutos / 60);
  const mins = minutos % 60;
  if (mins === 0) {
    return `${horas} hora${horas > 1 ? 's' : ''}`;
  }
  return `${horas} hora${horas > 1 ? 's' : ''} ${mins} min`;
};

// ============================================
// GET /api/parquimetros/verificar/:placa
// Verificar si una placa tiene tiempo vigente
// ============================================
router.get('/verificar/:placa', async (req, res) => {
  try {
    const { placa } = req.params;
    const placaUpper = placa.toUpperCase().trim();
    const ahora = new Date();

    console.log(`\n🔍 Verificando parquímetro para: ${placaUpper}`);

    // Buscar el pago más reciente de esta placa
    const { data: pago, error } = await supabase
      .from('pagos_parquimetro')
      .select('*')
      .eq('placa', placaUpper)
      .order('hora_fin', { ascending: false })
      .limit(1)
      .single();

    if (error || !pago) {
      console.log(`❌ No se encontró registro para ${placaUpper}`);
      return res.json({
        success: true,
        encontrado: false,
        placa: placaUpper,
        mensaje: 'No se encontró pago de parquímetro para esta placa',
      });
    }

    const horaFin = new Date(pago.hora_fin);
    const horaInicio = new Date(pago.hora_inicio);
    const diferenciaMs = horaFin - ahora;
    const diferenciaMin = Math.round(diferenciaMs / 60000);

    if (diferenciaMin > 0) {
      // ✅ TIEMPO VIGENTE
      console.log(`✅ ${placaUpper} tiene ${diferenciaMin} minutos restantes`);
      
      return res.json({
        success: true,
        encontrado: true,
        vigente: true,
        expirado: false,
        placa: placaUpper,
        zona: pago.zona,
        ubicacion: pago.ubicacion,
        parquimetro_id: pago.parquimetro_id,
        hora_inicio: pago.hora_inicio,
        hora_fin: pago.hora_fin,
        minutos_pagados: pago.minutos_pagados,
        tiempo_restante: calcularTiempo(diferenciaMin),
        tiempo_restante_min: diferenciaMin,
        monto_pagado: pago.monto,
        metodo_pago: pago.metodo_pago,
      });
    } else {
      // ❌ TIEMPO EXPIRADO
      const tiempoExpirado = Math.abs(diferenciaMin);
      console.log(`⏰ ${placaUpper} expiró hace ${tiempoExpirado} minutos`);

      // Actualizar estatus a expirado si no lo está
      if (pago.estatus !== 'expirado') {
        await supabase
          .from('pagos_parquimetro')
          .update({ estatus: 'expirado', updated_at: new Date().toISOString() })
          .eq('id', pago.id);
      }

      return res.json({
        success: true,
        encontrado: true,
        vigente: false,
        expirado: true,
        placa: placaUpper,
        zona: pago.zona,
        ubicacion: pago.ubicacion,
        parquimetro_id: pago.parquimetro_id,
        hora_inicio: pago.hora_inicio,
        hora_fin: pago.hora_fin,
        minutos_pagados: pago.minutos_pagados,
        tiempo_expirado: calcularTiempo(tiempoExpirado),
        tiempo_expirado_min: tiempoExpirado,
        monto_pagado: pago.monto,
      });
    }
  } catch (error) {
    console.error('❌ Error verificando parquímetro:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// POST /api/parquimetros/pagar
// Registrar un nuevo pago de parquímetro
// ============================================
router.post('/pagar', async (req, res) => {
  try {
    const {
      placa,
      zona,
      ubicacion,
      minutos,
      monto,
      metodo_pago,
      parquimetro_id,
    } = req.body;

    // Validaciones
    if (!placa) {
      return res.status(400).json({ success: false, error: 'La placa es requerida' });
    }
    if (!minutos || minutos <= 0) {
      return res.status(400).json({ success: false, error: 'Los minutos deben ser mayor a 0' });
    }

    const placaUpper = placa.toUpperCase().trim();
    const ahora = new Date();
    const horaFin = new Date(ahora.getTime() + minutos * 60000);

    console.log(`\n🅿️ Registrando pago de parquímetro`);
    console.log(`   Placa: ${placaUpper}`);
    console.log(`   Minutos: ${minutos}`);
    console.log(`   Vence: ${horaFin.toISOString()}`);

    const { data: pago, error } = await supabase
      .from('pagos_parquimetro')
      .insert({
        placa: placaUpper,
        zona: zona || 'General',
        ubicacion: ubicacion || null,
        hora_inicio: ahora.toISOString(),
        hora_fin: horaFin.toISOString(),
        minutos_pagados: minutos,
        monto: monto || 0,
        metodo_pago: metodo_pago || 'efectivo',
        parquimetro_id: parquimetro_id || null,
        estatus: 'activo',
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Pago registrado exitosamente`);

    res.json({
      success: true,
      mensaje: `Tiempo de ${calcularTiempo(minutos)} registrado para ${placaUpper}`,
      pago: {
        id: pago.id,
        placa: pago.placa,
        zona: pago.zona,
        hora_inicio: pago.hora_inicio,
        hora_fin: pago.hora_fin,
        tiempo_pagado: calcularTiempo(minutos),
        monto: pago.monto,
      },
    });
  } catch (error) {
    console.error('❌ Error registrando pago:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// POST /api/parquimetros/extender
// Extender tiempo de un pago existente
// ============================================
router.post('/extender', async (req, res) => {
  try {
    const { placa, minutos_extra, monto_extra } = req.body;

    if (!placa || !minutos_extra) {
      return res.status(400).json({ 
        success: false, 
        error: 'Placa y minutos_extra son requeridos' 
      });
    }

    const placaUpper = placa.toUpperCase().trim();

    // Buscar pago activo
    const { data: pagoActivo, error: errorBuscar } = await supabase
      .from('pagos_parquimetro')
      .select('*')
      .eq('placa', placaUpper)
      .eq('estatus', 'activo')
      .order('hora_fin', { ascending: false })
      .limit(1)
      .single();

    if (errorBuscar || !pagoActivo) {
      return res.status(404).json({
        success: false,
        error: 'No se encontró pago activo para esta placa',
      });
    }

    // Calcular nueva hora de fin
    const horaFinActual = new Date(pagoActivo.hora_fin);
    const nuevaHoraFin = new Date(horaFinActual.getTime() + minutos_extra * 60000);
    const nuevosMinutos = pagoActivo.minutos_pagados + minutos_extra;
    const nuevoMonto = (pagoActivo.monto || 0) + (monto_extra || 0);

    // Actualizar
    const { data: pagoActualizado, error: errorUpdate } = await supabase
      .from('pagos_parquimetro')
      .update({
        hora_fin: nuevaHoraFin.toISOString(),
        minutos_pagados: nuevosMinutos,
        monto: nuevoMonto,
        updated_at: new Date().toISOString(),
      })
      .eq('id', pagoActivo.id)
      .select()
      .single();

    if (errorUpdate) throw errorUpdate;

    console.log(`⏰ Tiempo extendido: +${minutos_extra} min para ${placaUpper}`);

    res.json({
      success: true,
      mensaje: `Tiempo extendido ${calcularTiempo(minutos_extra)} para ${placaUpper}`,
      pago: {
        id: pagoActualizado.id,
        placa: pagoActualizado.placa,
        nueva_hora_fin: pagoActualizado.hora_fin,
        tiempo_total: calcularTiempo(nuevosMinutos),
        monto_total: nuevoMonto,
      },
    });
  } catch (error) {
    console.error('❌ Error extendiendo tiempo:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// GET /api/parquimetros/historial/:placa
// Historial de pagos de una placa
// ============================================
router.get('/historial/:placa', async (req, res) => {
  try {
    const { placa } = req.params;
    const placaUpper = placa.toUpperCase().trim();

    const { data: pagos, error } = await supabase
      .from('pagos_parquimetro')
      .select('*')
      .eq('placa', placaUpper)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    res.json({
      success: true,
      placa: placaUpper,
      total: pagos.length,
      historial: pagos,
    });
  } catch (error) {
    console.error('❌ Error obteniendo historial:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// GET /api/parquimetros/activos
// Listar todos los pagos activos (tiempo vigente)
// ============================================
router.get('/activos', async (req, res) => {
  try {
    const ahora = new Date().toISOString();

    const { data: activos, error } = await supabase
      .from('pagos_parquimetro')
      .select('*')
      .eq('estatus', 'activo')
      .gte('hora_fin', ahora)
      .order('hora_fin', { ascending: true });

    if (error) throw error;

    // Agregar tiempo restante a cada uno
    const activosConTiempo = activos.map((pago) => {
      const horaFin = new Date(pago.hora_fin);
      const minRestantes = Math.round((horaFin - new Date()) / 60000);
      return {
        ...pago,
        tiempo_restante: calcularTiempo(minRestantes),
        tiempo_restante_min: minRestantes,
      };
    });

    res.json({
      success: true,
      total: activos.length,
      activos: activosConTiempo,
    });
  } catch (error) {
    console.error('❌ Error obteniendo activos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// GET /api/parquimetros/expirados
// Listar pagos que ya expiraron (para agentes)
// ============================================
router.get('/expirados', async (req, res) => {
  try {
    const ahora = new Date().toISOString();

    const { data: expirados, error } = await supabase
      .from('pagos_parquimetro')
      .select('*')
      .lt('hora_fin', ahora)
      .in('estatus', ['activo', 'expirado'])
      .order('hora_fin', { ascending: false })
      .limit(50);

    if (error) throw error;

    // Agregar tiempo expirado a cada uno
    const expiradosConTiempo = expirados.map((pago) => {
      const horaFin = new Date(pago.hora_fin);
      const minExpirado = Math.round((new Date() - horaFin) / 60000);
      return {
        ...pago,
        tiempo_expirado: calcularTiempo(minExpirado),
        tiempo_expirado_min: minExpirado,
      };
    });

    res.json({
      success: true,
      total: expirados.length,
      expirados: expiradosConTiempo,
    });
  } catch (error) {
    console.error('❌ Error obteniendo expirados:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// PATCH /api/parquimetros/:id/marcar-multado
// Marcar un pago como multado
// ============================================
router.patch('/:id/marcar-multado', async (req, res) => {
  try {
    const { id } = req.params;
    const { folio_multa } = req.body;

    const { data, error } = await supabase
      .from('pagos_parquimetro')
      .update({
        estatus: 'multado',
        folio_multa: folio_multa || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    console.log(`🚨 Pago ${id} marcado como multado`);

    res.json({
      success: true,
      mensaje: 'Pago marcado como multado',
      pago: data,
    });
  } catch (error) {
    console.error('❌ Error marcando como multado:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// GET /api/parquimetros/zonas
// Listar zonas y tarifas
// ============================================
router.get('/zonas', async (req, res) => {
  try {
    const { data: zonas, error } = await supabase
      .from('zonas_parquimetro')
      .select('*')
      .eq('activa', true)
      .order('nombre');

    if (error) throw error;

    res.json({
      success: true,
      total: zonas.length,
      zonas,
    });
  } catch (error) {
    console.error('❌ Error obteniendo zonas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// GET /api/parquimetros/estadisticas
// Estadísticas generales
// ============================================
router.get('/estadisticas', async (req, res) => {
  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    // Total de pagos hoy
    const { count: pagosHoy } = await supabase
      .from('pagos_parquimetro')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', hoy.toISOString());

    // Total activos ahora
    const { count: activos } = await supabase
      .from('pagos_parquimetro')
      .select('*', { count: 'exact', head: true })
      .eq('estatus', 'activo')
      .gte('hora_fin', new Date().toISOString());

    // Total expirados sin multar hoy
    const { count: expirados } = await supabase
      .from('pagos_parquimetro')
      .select('*', { count: 'exact', head: true })
      .eq('estatus', 'expirado')
      .gte('created_at', hoy.toISOString());

    // Ingresos de hoy
    const { data: ingresos } = await supabase
      .from('pagos_parquimetro')
      .select('monto')
      .gte('created_at', hoy.toISOString());

    const totalIngresos = ingresos?.reduce((sum, p) => sum + (p.monto || 0), 0) || 0;

    res.json({
      success: true,
      fecha: hoy.toISOString().split('T')[0],
      estadisticas: {
        pagos_hoy: pagosHoy || 0,
        activos_ahora: activos || 0,
        expirados_hoy: expirados || 0,
        ingresos_hoy: totalIngresos,
      },
    });
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;