// Variables globales
let simuladorGlobal = null;
let visualizadorGlobal = null;

// Utilidades de UI
function renderIndicadores(sim) {
  const el = document.getElementById('indicadores');
  if (!el || !sim) return;
  const tiempo = sim.tiempoActual? sim.tiempoActual-1: 0;
  const terminados = sim.procesosCompletados.length?? 0;
  const fragExt = sim.fragmentacionExternaAcumulada?? 0;
  const retorno =sim.calculoTRs().map(p=>`<li>${p.nombre}: ${p.tr}</li>`).join('');
  const medioRetorno =sim.calculoTRM();
  const retornoTanda =sim.calculoTRTanda();
  el.innerHTML = `
    <ul>
      <li>Cantidad de Procesos Completados: ${terminados}</li>
      <li>Tiempo total (UT): ${tiempo}</li>
      <li>Tiempo de Retorno individual:
        <ul>
          ${retorno}
        </ul>   
      </li>
      <li>Tiempo de Retorno de la Tanda:${retornoTanda} </li>
      <li>Tiempo de Retorno Medio: ${medioRetorno} </li>
      <li>Índice de Fragmentacion Externa:${fragExt}</li>
    </ul>
  `;
}

function renderEventos(sim) {
  const el = document.getElementById('eventLog');
  if (!el || !sim) return;
  const eventos = sim.eventos || [];
  el.innerHTML = eventos.map(e => `<div class="log-entry">${e}</div>`).join('');
}

function crearSimuladorDesdeUI(datosJSON) {
  const configuracion = {
    memoriaTotal: parseInt(document.getElementById('memoriaTotal').value, 10),
    estrategia: document.getElementById('estrategia').value,
    tiempoSeleccion: parseInt(document.getElementById('tiempoSeleccion').value, 10),
    tiempoCarga: parseInt(document.getElementById('tiempoCarga').value, 10),
    tiempoLiberacion: parseInt(document.getElementById('tiempoLiberacion').value, 10),
  };
  if (configuracion.memoriaTotal < 1) {
    throw new Error('La memoria total debe ser al menos 1');
  }
  return new SimuladorMemoria(configuracion, datosJSON);
}

function crearVisualizador(sim) {
  return new VisualizadorMemoria(sim, { canvasId: 'memoriaCanvas' });
}

function instalarRedimensionado(visualizador) {
  if (!visualizador || !visualizador.canvas) return;
  const handler = () => {
    visualizador.cargarFramesDesdeHistorial();
    visualizador.dibujarDiagramaGantt();
  };
  // Evitar múltiples listeners en sucesivas simulaciones
  window.removeEventListener('resize', handler);
  window.addEventListener('resize', handler);
}

function simulacionPendiente(sim) {
  return (
    (sim.procesos && sim.procesos.length > 0) ||
    (sim.colaSOTasks && sim.colaSOTasks.length > 0) ||
    !!sim.soTareaActual
  );
}

// Ejecuta la simulación completa de forma sincrónica
async function iniciarSimulacion() {
  try {
    const archivoInput = document.getElementById('archivoJSON');
    if (!archivoInput.files.length) {
      alert('Por favor, seleccione un archivo JSON');
      return;
    }
    const file = archivoInput.files[0];
    const texto = await file.text();
    const datosJSON = JSON.parse(texto);

    simuladorGlobal = crearSimuladorDesdeUI(datosJSON);

    // Ejecutar hasta terminar o tope de seguridad
    const maxTicks = 100000; // tope para evitar loops infinitos
    let ticks = 0;
    while (simulacionPendiente(simuladorGlobal) && ticks < maxTicks) {
      simuladorGlobal.ejecutarTick();
      ticks++;
    }

    visualizadorGlobal = crearVisualizador(simuladorGlobal);
    visualizadorGlobal.cargarFramesDesdeHistorial();
    visualizadorGlobal.dibujarDiagramaGantt();
    instalarRedimensionado(visualizadorGlobal);

    renderIndicadores(simuladorGlobal);
    renderEventos(simuladorGlobal);
  } catch (error) {
    console.error('Error en la simulación:', error);
    alert('Error: ' + error.message);
  }
}

// Anima la simulación paso a paso
function animarSimulacion() {
  try {
    const archivoInput = document.getElementById('archivoJSON');
    if (!archivoInput.files.length) {
      alert('Por favor, seleccione un archivo JSON');
      return;
    }

    const file = archivoInput.files[0];
    file
      .text()
      .then((texto) => {
        const datosJSON = JSON.parse(texto);
        simuladorGlobal = crearSimuladorDesdeUI(datosJSON);
        visualizadorGlobal = crearVisualizador(simuladorGlobal);
        instalarRedimensionado(visualizadorGlobal);
        const velocidad = parseInt(document.getElementById('velocidadAnimacion').value, 10) || 300;

        function ejecutarPasoAnimado() {
          if (simulacionPendiente(simuladorGlobal)) {
            simuladorGlobal.ejecutarTick();
            visualizadorGlobal.cargarFramesDesdeHistorial();
            visualizadorGlobal.dibujarDiagramaGantt();
            setTimeout(ejecutarPasoAnimado, velocidad);
          } else {
            renderIndicadores(simuladorGlobal);
            renderEventos(simuladorGlobal);
          }
        }

        ejecutarPasoAnimado();
      })
      .catch((err) => {
        console.error('Error al leer el archivo:', err);
        alert('Error leyendo el archivo JSON');
      });
  } catch (error) {
    console.error('Error en la animación:', error);
    alert('Error: ' + error.message);
  }
}
