class VisualizadorMemoria {
  constructor(simulador, { canvasId = null, canvas = null } = {}) {
    this.simulador = simulador;
    this.canvas = canvas || (canvasId ? document.getElementById(canvasId) : null);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.frames = []; // { tiempo, bloques: [{inicio,tamaño,estado,proceso}] }
    this.escalaX = 20;
    this.escalaY = 10;
    this.margins = { left: 42, right: 10, top: 16, bottom: 24 };
    this.coloresProcesos = {};
    this._theme = {
      axis: '#000',
      tick: '#666',
      grid: '#e9e9e9',
      free: '#e0e0e0',
      label: '#000',
    };
  }

  get memoriaTotal() {
    return Number(this.simulador?.memoriaTotal ?? 0);
  }

  // Construye un resumen de procesos desde el simulador
  resumenProcesos({ ocultarLiberacion = true } = {}) {
    const activos = Array.isArray(this.simulador?.procesos) ? this.simulador.procesos : [];
    const completados = Array.isArray(this.simulador?.procesosCompletados) ? this.simulador.procesosCompletados : [];
    const todos = [...activos, ...completados];
    return todos.map(p => ({
      nombre: p.nombre,
      arribo: p.arribo,
      memoria: p.memoria,
      finSeleccion: p.tiempoSeleccion ?? null,
      finCarga: p.tiempoCarga ?? null,
      finCPU: p.tiempoDuracion ?? null,
      liberacion: ocultarLiberacion ? null : (p.tiempoLiberacion ?? null),
      estado: p.estado
    }));
  }

  // Convierte un snapshot de particiones del simulador a bloques para graficarlos
  _bloquesDesdeParticiones(particiones) {
    const arr = Array.isArray(particiones) ? particiones : [];
    return arr.map(p => ({
      inicio: Number(p.inicio) || 0,
      tamaño: Number(p.tamaño) || 0,
      estado: p.estado === 'ocupada' ? 'ocupada' : 'libre',
      proceso: p.estado === 'ocupada' ? (p.proceso?.nombre ?? p.proceso?.id ?? null) : null,
      // Metadata copiada del snapshot para decidir visualización
      _procesoEstado: p.proceso?.estado ?? null,
      _tFinCPU: (typeof p.proceso?.tiempoDuracion === 'number') ? p.proceso.tiempoDuracion : null,
      _tFinLib: (typeof p.proceso?.tiempoLiberacion === 'number') ? p.proceso.tiempoLiberacion : null,
    }));
  }

  cargarFramesDesdeHistorial() {
    const hist = Array.isArray(this.simulador?.historialMemoria) ? this.simulador.historialMemoria : [];
    this.frames = hist.map(h => ({
      tiempo: Number(h.tiempo) || 0,
      bloques: this._bloquesDesdeParticiones(h.particiones)
    }));
  }

  // Obtiene el último tiempo con ocupación real
  _lastActiveTime() {
    let last = 0;
    for (const f of this.frames) {
      const anyOcc = (f.bloques || []).some(b => b && b.estado === 'ocupada');
      if (anyOcc && f.tiempo > last) last = f.tiempo;
    }
    return last;
  }

  // Determina si un bloque debe mostrarse como ocupado en un tiempo dado
  _esOcupadaVisible(bloque, tiempo) {
    if (!bloque || bloque.estado !== 'ocupada') return false;
    const finCPU = typeof bloque._tFinCPU === 'number' ? bloque._tFinCPU : null;
    const estadoProc = bloque._procesoEstado || null;
    // No mostrar a partir del tick en que finaliza CPU
    if (finCPU !== null && tiempo >= finCPU) return false;
    //  ocultar si el estado ya es de liberación/espera de liberación
    if (estadoProc === 'liberacion' || estadoProc === 'finalizado_esperando_liberacion') return false;
    return true;
  }

  // Último tiempo con ocupación visible 
  _lastActiveVisibleTime() {
    let last = -1;
    for (const f of this.frames) {
      const anyVisible = (f.bloques || []).some(b => this._esOcupadaVisible(b, f.tiempo));
      if (anyVisible && f.tiempo > last) last = f.tiempo;
    }
    return Math.max(0, last);
  }

  // Lee de los eventos el último tiempo en que algún proceso "terminó su ejecución"
  _ultimoTiempoFinCPUDesdeEventos() {
    const evs = Array.isArray(this.simulador?.eventos) ? this.simulador.eventos : [];
    let maxT = null;
    for (const e of evs) {
      // Formato esperado: "[t]: mensaje..."
      const m = /^\[(\d+)\]:\s*(.*)$/.exec(String(e));
      if (!m) continue;
      const t = Number(m[1]);
      const msg = m[2] || '';
      if (msg.includes('terminó su ejecución')) {
        if (maxT === null || t > maxT) maxT = t;
      }
    }
    return maxT;
  }

  // Dibuja todos los frame acumulados 
  dibujarDiagramaGantt() {
    if (!this.ctx || !this.canvas) return;
    if (!this.frames.length) this.cargarFramesDesdeHistorial();

    // Determinar el último tick visible segun eventos y ocupación visible
    const tFinCPUev = this._ultimoTiempoFinCPUDesdeEventos();
    const lastVisibleByScan = this._lastActiveVisibleTime();
    // Si hay evento de fin de CPU
    const lastActive = (typeof tFinCPUev === 'number') ? Math.max(0, tFinCPUev) : lastVisibleByScan;
    const datos = this.frames.filter(f => f.tiempo <= lastActive);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!datos.length) return;

    const maxTiempo = Math.max(...datos.map(d => d.tiempo));
    const maxMemoria = this.memoriaTotal || Math.max(0, ...datos.flatMap(d => d.bloques.map(b => (b.inicio + b.tamaño))));

    // Ajuste del canvas en función del contenedor y la cantidad de ticks
    const parent = this.canvas.parentElement;
    const marginsW = (this.margins?.left || 0) + (this.margins?.right || 0);
    const marginsH = (this.margins?.top || 0) + (this.margins?.bottom || 0);
    const minBarWidth = 14; // ancho mínimo por UT para legibilidad
    const desiredPlotW = (maxTiempo + 1) * minBarWidth;
    const parentW = parent ? parent.clientWidth : this.canvas.width;
    const targetW = Math.max(parentW, desiredPlotW + marginsW);

    // Altura objetivo en función de memoria acotada, para que no se haga giggante
    const minCanvasH = 320;
    const maxCanvasH = 720;
    const pxPerMemUnit = 3; // 3px por unidad de memoria (aprox.)s
    const desiredPlotH = Math.max(200, Math.min(maxMemoria * pxPerMemUnit, maxCanvasH - marginsH));
    const targetH = Math.max(minCanvasH, desiredPlotH + marginsH);

    // Si cambia el tamaño, actualizar y reconstruir contexto (se resetea al cambiar width/height)
    if (this.canvas.width !== Math.floor(targetW) || this.canvas.height !== Math.floor(targetH)) {
      this.canvas.width = Math.floor(targetW);
      this.canvas.height = Math.floor(targetH);
      this.ctx = this.canvas.getContext('2d');
    }

    // Escalas
    const plotW = Math.max(10, this.canvas.width - this.margins.left - this.margins.right);
    const plotH = Math.max(10, this.canvas.height - this.margins.top - this.margins.bottom);
    this.escalaX = Math.max(6, Math.floor(plotW / (maxTiempo + 1)));
    this.escalaY = maxMemoria > 0 ? (plotH / maxMemoria) : 10;

    // Ejes
    this.ctx.strokeStyle = this._theme.axis;
    this.ctx.lineWidth = 1;
    const originX = this.margins.left;
    const originY = this.canvas.height - this.margins.bottom;
    const endX = this.canvas.width - this.margins.right;
    const endY = this.margins.top;
    // eje X
    this.ctx.beginPath();
    this.ctx.moveTo(originX, originY + 0.5);
    this.ctx.lineTo(endX, originY + 0.5);
    this.ctx.stroke();
    // eje Y
    this.ctx.beginPath();
    this.ctx.moveTo(originX + 0.5, originY);
    this.ctx.lineTo(originX + 0.5, endY);
    this.ctx.stroke();

    const niceStep = (max, target) => {
      const raw = Math.max(1, max / Math.max(1, target));
      const pow = Math.pow(10, Math.floor(Math.log10(raw)));
      const base = raw / pow;
      const mult = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
      return mult * pow;
    };

    // X ticks/grid
    const stepX = niceStep(maxTiempo, Math.floor(plotW / 80));
    this.ctx.fillStyle = this._theme.label;
    this.ctx.font = '10px system-ui, Arial';
    this.ctx.strokeStyle = this._theme.tick;
    for (let t = 0; t <= maxTiempo; t += stepX) {
      const x = originX + t * this.escalaX;
      this.ctx.beginPath();
      this.ctx.moveTo(x + 0.5, originY + 0.5);
      this.ctx.lineTo(x + 0.5, originY - 5);
      this.ctx.stroke();
      this.ctx.fillText(String(t), x - 2, originY + 14);
      this.ctx.strokeStyle = this._theme.grid;
      this.ctx.beginPath();
      this.ctx.moveTo(x + 0.5, originY);
      this.ctx.lineTo(x + 0.5, endY);
      this.ctx.stroke();
      this.ctx.strokeStyle = this._theme.tick;
    }

    // Y ticks/grid
    const stepY = niceStep(maxMemoria, Math.floor(plotH / 48));
    for (let m = 0; m <= maxMemoria; m += stepY) {
      const y = originY - m * this.escalaY;
      this.ctx.beginPath();
      this.ctx.moveTo(originX, y + 0.5);
      this.ctx.lineTo(originX + 5, y + 0.5);
      this.ctx.strokeStyle = this._theme.tick;
      this.ctx.stroke();
      this.ctx.fillStyle = this._theme.label;
      this.ctx.fillText(String(m), 6, Math.max(endY + 10, y - 2));
      this.ctx.strokeStyle = this._theme.grid;
      this.ctx.beginPath();
      this.ctx.moveTo(originX, y + 0.5);
      this.ctx.lineTo(endX, y + 0.5);
      this.ctx.stroke();
    }

    // Totales
    this.ctx.fillStyle = this._theme.label;
    this.ctx.font = '12px system-ui, Arial';
    this.ctx.fillText(`Tiempo total: ${maxTiempo}`, originX + 80, this.margins.top - 2 + 14);
    this.ctx.fillText(`Memoria total: ${maxMemoria}`, originX + 220, this.margins.top - 2 + 14);

    // Bloques por frame
    for (const estadoTiempo of datos) {
      const x = originX + estadoTiempo.tiempo * this.escalaX;
      for (const bloque of estadoTiempo.bloques) {
        const y = originY - (bloque.inicio + bloque.tamaño) * this.escalaY;
        const height = bloque.tamaño * this.escalaY;

        // Ocultar ocupación durante tiempos de liberación (SO), sin tocar la lógica del simulador.
        const isLibreVisual = (bloque.estado === 'libre') || !this._esOcupadaVisible(bloque, estadoTiempo.tiempo);
        this.ctx.fillStyle = isLibreVisual ? this._theme.free : this.getColor(bloque.proceso);
        this.ctx.fillRect(x, y, this.escalaX - 1, height);
        if(!isLibreVisual){
          this.ctx.strokeStyle = '#666';
          this.ctx.strokeRect(x + 0.5, y + 0.5, this.escalaX - 2, height - 1); 
        }

        if (bloque.proceso && !isLibreVisual && this.escalaX > 18) {
          this.ctx.fillStyle = '#000';
          this.ctx.font = '8px Arial';
          this.ctx.fillText(String(bloque.proceso), x + 2, y + Math.max(8, height / 2));
        }
      }
    }

    // Etiquetas ejes
    this.ctx.fillStyle = this._theme.label;
    this.ctx.font = '12px system-ui, Arial';
    const midX = originX + (endX - originX) / 2;
    this.ctx.fillText('Tiempo', midX - 20, originY + 20);
    this.ctx.save();
    this.ctx.translate(12, (originY + endY) / 2);
    this.ctx.rotate(-Math.PI / 2);
    this.ctx.fillText('Memoria', -28, 0);
    this.ctx.restore();
  }

  getColor(nombreProceso) {
    const key = String(nombreProceso ?? '—');
    if (!this.coloresProcesos[key]) {
      const colores = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9c74f', '#90be6d', '#577590', '#d37eb9'];
      this.coloresProcesos[key] = colores[Object.keys(this.coloresProcesos).length % colores.length];
    }
    return this.coloresProcesos[key];
  }
}

// UMD-lite export for browser without modules
if (typeof window !== 'undefined') {
  window.VisualizadorMemoria = window.VisualizadorMemoria || VisualizadorMemoria;
}
// Node/CommonJS export (no-op in browser)
if (typeof module !== 'undefined') {
  module.exports = { VisualizadorMemoria };
}
