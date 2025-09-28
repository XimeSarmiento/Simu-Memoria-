class Proceso {
    /**
     * @param {String} Nombre - Identificador del proceso 
     * @param {Number} Arribo - Tiempo de arribo del proceso
     * @param {Number} Duracion - Duración del proceso en CPU
     * @param {Number} Memoria - Cantidad de memoria requerida por el proceso
     * @param {String} Estado - Estado actual del proceso - Tipos de estados posibles: "nuevo","espera","seleccion","carga","en_memoria", "finalizado")
     * @param {Number} tiempoSeleccion - Tiempo en el que estuvo en selección
     * @param {Number} tiempoCarga - Tiempo en el que estuvo en carga
     * @param {Number} tiempoDuracion - Tiempo en que el proceso comenzó su ejecución en CPU
     * @param {Number} TiempoLiberacion - Tiempo en que el proceso liberó la memoria
     * @param {Number} indice - Donde arranca este proceso (índice de partición). 
     */

    constructor(nombre, arribo, duracion, memoria) {
    this.nombre = nombre;
    this.arribo = Number(arribo);
    this.duracion = Number(duracion);
    this.memoria = Number(memoria);
    this.indice = null;

    /**  estados: "nuevo","espera","seleccion","carga",
    "en_memoria","completado"*/
    this.estado = "nuevo";

    // tiempos y marcas
    this.tiempoSeleccion = null;
    this.tiempoCarga = null;
    this.tiempoDuracion = null;
    this.tiempoLiberacion = null;
  }
}

class Particion {
  constructor(inicio, tamaño, estado = "libre") {
    this.inicio = Number(inicio);
    this.tamaño = Number(tamaño);
    this.estado = estado; // "libre" | "ocupada"
    this.proceso = null;
  }
}

class SimuladorMemoria {
  constructor(config, datosJSON) {
    // configuración por defecto (se sobrescribe en inicializar)
    this.memoriaTotal = config.memoriaTotal;
    this.estrategia = config.estrategia || "first-fit";
    this.tiempoSeleccion = config.tiempoSeleccion;
    this.tiempoCarga = config.tiempoCarga;
    this.tiempoLiberacion = config.tiempoLiberacion;
    this.procesos = []; // array de procesos activos (no completados)

    this.particiones = [new Particion(0, this.memoriaTotal)]; //array de Particion inicializado.
    this.procesos = datosJSON.map(j => new Proceso(j.nombre, j.tiempo_arribo, j.duracion, j.memoria_requerida)).sort((a,b) => a.tiempo_arribo - b.tiempo_arribo); // procesos "activos" (no completados)

    this.procesosCompletados = []; // procesos que ya completaron todo su ciclo
    this.tiempoActual = 0; 

    // SO
    this.colaSOTasks = [];  
    this.soTareaActual = null; 
    this.masDuno =[] ; //hay mas de una liberacione en el mismo tick
    // historial para visualización 
    this.eventos = []; // Guarda los eventos que ocurren para luego motrarlos, en forma de text
    this.historialMemoria = []; // Guarda el tick y el estado de memoria en ese tiempo. 

    // next-fit
    this.proximoIndiceNextFit = 0;

    // indicador de fragmentación 
    this.fragmentacionExternaAcumulada = 0;

    this.agregarEvento(`Simulación iniciada. Memoria=${this.memoriaTotal}, Estrategia=${this.estrategia}`, { tipo: 'inicio' });
  }

  agregarEvento(mensaje){
    this.eventos.push(`[${this.tiempoActual}]: ${mensaje}`);
  }
  /*------------ FLUJO DE CAMBIO DE ESTADO ------------*/
  haySeleccionPendiente(){
    if (!this.colaSOTasks.length) {return false;}
    return this.colaSOTasks.some(t => t.estado === "seleccion"); // devuelve true si hay alguna tarea de selección pendiente
  }
  
  hayEsperaPendiente(){
    if (!this.colaSOTasks.length) {return false;}
    return this.colaSOTasks.some(t => t.estado === "espera");
  }

  seleccionarIndiceParticion(proceso) {
    let mem = proceso.memoria;
    let pos = -1;
    switch (this.estrategia) {
      case "first-fit": pos = this.buscarFirstFit(mem); break;
      case "best-fit": pos = this.buscarBestFit(mem); break;
      case "worst-fit": pos = this.buscarWorstFit(mem); break;
      case "next-fit": pos = this.buscarNextFit(mem); break;
    }
    if (pos == -1) {
      this.agregarEvento(`No hay espacio para ${proceso.nombre} (${mem}KB)`);
      proceso.indice = -1;
      return -1;
    }
    proceso.indice = pos; // guardamos la posición inicial del hueco
    this.agregarEvento(`Seleccionado hueco inicio=${pos} para ${proceso.nombre} (${mem}KB)`);
  }
  
  nuevoAts(){
    // Si el SO está ocupado, no iniciar nueva selección
    if (this.soTareaActual) {return;}
    if (!this.procesos.length) {return;}
    if (this.haySeleccionPendiente() || this.hayEsperaPendiente()){return;}
    // Solo iniciar cuando el primer proceso ya arribó
    if (this.procesos[0].arribo > this.tiempoActual) {return;}
    // Tomar el siguiente proceso y comenzar selección inmediatamente
    this.soTareaActual = this.procesos.shift();
    this.soTareaActual.estado = "seleccion";
    this.agregarEvento(`Proceso ${this.soTareaActual.nombre} ingresó a selección`);
    this.seleccionarIndiceParticion(this.soTareaActual);
    this.soTareaActual.tiempoSeleccion = this.tiempoActual + this.tiempoSeleccion;
  }

  tsAtc(){
    if (this.soTareaActual) {return;} // no hay proceso en SO
    if (!this.colaSOTasks.length) {return;}
    if (this.hayEsperaPendiente()) {return;} 
    let indx = this.colaSOTasks.findIndex(t => t.estado === "seleccion");
    if (indx === -1) {return;}
    this.soTareaActual = this.colaSOTasks.splice(indx, 1)[0]; // saca el proceso de la cola
    this.soTareaActual.estado = "carga"; 
    this.soTareaActual.tiempoCarga = this.tiempoActual + this.tiempoCarga;
    this.agregarEvento(`Proceso ${this.soTareaActual.nombre} comenzó carga en memoria`);
  }

  liberacion(){
    if (this.soTareaActual) {return;}
    if (!this.colaSOTasks.length) {return;}
    this.colaSOTasks.sort((j,k) => j.arribo - k.arribo).forEach(p =>{
        if(p.estado==="en_memoria"){
            if (this.tiempoActual >= p.tiempoDuracion){
                const idx = this.particiones.findIndex(par => par.estado === 'ocupada' && par.proceso === p); 
                if (idx !== -1) { this.particiones[idx].estado = 'libre'; 
                }
                this.masDuno.push(p);
            }
        }
    });
    if(this.masDuno.length>0){
      this.cargarProxLiberacion();
    }
  }

  cargarProxLiberacion(){
    if(this.masDuno.length === 0) return;
    const prox = this.masDuno.shift();
    this.soTareaActual = prox;
    this.soTareaActual.estado = "liberacion";
    this.soTareaActual.tiempoLiberacion = this.tiempoActual + this.tiempoLiberacion;
    this.colaSOTasks = this.colaSOTasks.filter(proc => proc.nombre !== this.soTareaActual.nombre); // lo saca de la cola
    this.agregarEvento(`Proceso ${this.soTareaActual.nombre} terminó su ejecución, esperando liberación de memoria`);
  }

  terminadosEstados(){
    if (!this.soTareaActual) {return;}
    switch(this.soTareaActual.estado){
      case "seleccion": 
      if (this.tiempoActual >= this.soTareaActual.tiempoSeleccion){ 
        this.soTareaActual.estado = "seleccion";
        this.colaSOTasks.push(this.soTareaActual);  
        this.agregarEvento(`Proceso ${this.soTareaActual.nombre} termino seleccion`);
        this.soTareaActual = null;
        } 
        break;
      case "carga":
      if (this.tiempoActual >= this.soTareaActual.tiempoCarga){ 
        this.soTareaActual.estado = "espera";
        this.colaSOTasks.push(this.soTareaActual);
        this.agregarEvento(`Proceso ${this.soTareaActual.nombre} termino carga`);
        this.soTareaActual = null;
        } 
        break;
        case "liberacion":
        if (this.tiempoActual >= this.soTareaActual.tiempoLiberacion){
            this.liberarMemoria(this.soTareaActual, this.tiempoActual);
            this.soTareaActual.estado = "completado";
            this.procesosCompletados.push(this.soTareaActual);
            this.agregarEvento(`Proceso ${this.soTareaActual.nombre} liberó memoria y completó su ciclo`);
            this.soTareaActual = null;
            if(this.masDuno.length>0){
              this.cargarProxLiberacion();
            }
        }   
        break;
     }
  }

  cargar_memoria(){
      if (this.soTareaActual) {return;}
      if (!this.colaSOTasks.length) {return;}
      this.colaSOTasks.forEach(p =>{
          if(p.estado==="espera"){
            if (p.indice == null || p.indice < 0)  { this.seleccionarIndiceParticion(p); }
            if (p.indice != null && p.indice >= 0) {
              const pudo = this.crear_particion(p);
              if (pudo) {
                p.estado = "en_memoria";
                p.tiempoDuracion = this.tiempoActual + p.duracion;
                this.agregarEvento(`Proceso ${p.nombre} salió de espera y fue cargado en memoria`);
              }
            }
          }
      });
  }
  /*------------MANEJO DE PARTICIONES ------------*/
  crear_particion(proceso) {
    const pos = proceso.indice; // posición seleccionada
    const mem = proceso.memoria;
    if (!Number.isFinite(pos) || pos < 0) {
      this.agregarEvento(`Posición inválida para ${proceso.nombre}: ${pos}`);
      return false;
    }
    // Buscar una partición libre que contenga completamente [pos, pos+mem)
    const idx = this.particiones.findIndex(p => p.estado === "libre" && p.inicio <= pos && (pos + mem) <= (p.inicio + p.tamaño));
    if (idx === -1) {
      this.agregarEvento(`No se encontró partición libre que contenga inicio=${pos} para ${proceso.nombre}`);
      proceso.indice = -1;
      return false;
    }
    const part = this.particiones[idx];
    const leftSize = pos - part.inicio;
    const rightSize = (part.inicio + part.tamaño) - (pos + mem);

    const nuevos = [];
    if (leftSize > 0) {
      nuevos.push(new Particion(part.inicio, leftSize, "libre"));
    }
    const ocupada = new Particion(pos, mem, "ocupada");
    ocupada.proceso = proceso;
    nuevos.push(ocupada);
    if (rightSize > 0) {
      nuevos.push(new Particion(pos + mem, rightSize, "libre"));
    }

    // Reemplazar la partición original por las nuevas
    this.particiones.splice(idx, 1, ...nuevos);

    if (leftSize > 0 || rightSize > 0) {
      this.agregarEvento(`Se fragmentó partición para ${proceso.nombre}: ${mem}KB`, { tipo: 'fragmentacion', proceso: proceso.nombre, t: this.tiempoActual });
    }
    this.agregarEvento(`Asignada partición a ${proceso.nombre} (${mem}KB) en inicio ${pos}` , { tipo: 'asignacion', proceso: proceso.nombre, t: this.tiempoActual });

    return true;
  }

  liberarMemoria(proceso, tiempoActual) {
    const idx = this.particiones.findIndex(p => p.proceso === proceso);
    if (idx !== -1) {
      const part = this.particiones[idx];
      part.estado = "libre";
      part.proceso = null;
      part.tiempoLiberacion = tiempoActual; 
      proceso.estado = "completado";
      proceso.tiempoLiberacion = tiempoActual; 

      this.agregarEvento(`Liberada partición de ${proceso.nombre} (tamaño ${part.tamaño}KB)`, { tipo: 'liberacion_fin', proceso: proceso.nombre, t: tiempoActual });
      this.fusionarParticionesLibres();

      // removerlo de la lista de procesos activos
      this.procesos = this.procesos.filter(p => p !== proceso);  // REMOVERLO DE LA LISTA DE PROCESOS ACTIVOS
      return true;
    }
    return false;
  }

  fusionarParticionesLibres() {
    let i = 0; 
    while (i < this.particiones.length - 1) {
      if (this.particiones[i].estado === "libre" && this.particiones[i + 1].estado === "libre") {
        this.particiones[i].tamaño += this.particiones[i + 1].tamaño;
        this.particiones.splice(i + 1, 1);
        this.agregarEvento(`Particiones fusionadas en inicio ${this.particiones[i].inicio}`, { tipo: 'fusion' });
      } else {
        i++;
      }
    }
  }

  buscarFirstFit(memoriaRequerida) {
    const p = this.particiones.find((p) => p.estado === "libre" && p.tamaño >= memoriaRequerida);
    return p ? p.inicio : -1; //Si no me encuentra devuelve -1
  }

  buscarBestFit(memoriaRequerida) {
    let mejorParticion = null;
    let menorDesperdicio = Infinity;
    this.particiones.forEach((p) => {
        if (p.estado === "libre" && p.tamaño >= memoriaRequerida) {
            const desperdicio = p.tamaño - memoriaRequerida;
            if (desperdicio < menorDesperdicio) {
                mejorParticion = p;
                menorDesperdicio = desperdicio;
            }
        }
    });
    
    return mejorParticion ? mejorParticion.inicio : -1;
  }

  buscarWorstFit(memoriaRequerida) {
    let peorInicio = -1; let tamaño = -1;
    this.particiones.forEach((p) => {
      if (p.estado === "libre" && p.tamaño >= memoriaRequerida && p.tamaño > tamaño) {
        peorInicio = p.inicio; 
        tamaño = p.tamaño;
      }
    });
    return peorInicio; // Devuelve -1 si no encontró
  }

  buscarNextFit(memoriaRequerida) {
    const n = this.particiones.length;
    if (n === 0) return -1;
    for (let i = 0; i < n; i++) {
      const idx = (this.proximoIndiceNextFit + i) % n;
      const p = this.particiones[idx];
      if (p.estado === "libre" && p.tamaño >= memoriaRequerida) {
        this.proximoIndiceNextFit = idx + 1;
        return p.inicio;
      }
    }
    return -1;
  }
  /*------------ CAPTURA EN CADA TICK ------------*/
  GuardarTick() {
    this.historialMemoria.push({
        tiempo: this.tiempoActual,
        particiones: JSON.parse(JSON.stringify(this.particiones))
    });
  }

  /*------------ CALCULOS INDICADORES ------------*/
  calcularFragmento(){
    let acum=0;
    this.particiones.forEach(p=> {
      if(p.estado==="libre"){
        acum+= p.tamaño;
      }
    });
    return acum;
  }

  calculoFragExt(){
    let hayQueContar = false;
    // procesos que ya arribaron y aún no iniciaron
    if (this.procesos.length && this.procesos.some(p => p.arribo <= this.tiempoActual)) {
      hayQueContar = true;
    }
    //proceso actual en selección o carga
    if (this.soTareaActual && (this.soTareaActual.estado === "seleccion" || this.soTareaActual.estado === "carga")) {
      hayQueContar = true;
    }
    //procesos en cola del SO en selección o carga
    if (this.colaSOTasks && this.colaSOTasks.some(p => p.estado === "seleccion" || p.estado === "carga" || p.estado ==="espera")) {
      hayQueContar = true;
    }

    // Si se cumplió al menos una → cuenta todo el tick
    if (hayQueContar) {
      return this.calcularFragmento();
    }
    return 0; 
  }
  

  calculoTRs(){
    const trS= [];
    this.procesosCompletados.forEach(p=>{
      trS.push({
        nombre:p.nombre,
        tr:p.tiempoLiberacion-p.tiempoSeleccion +1
      });
    });
    return trS;
  }

  calculoTRM(){
    const trs= this.calculoTRs();
    let sumatoria = 0;
    trs.forEach(p=>{
      sumatoria+= p.tr;
    });
    const promedio = trs.length>0?(sumatoria/trs.length):0;
    return promedio;
  }

  calculoTRTanda(){
    const primerSelec = this.procesosCompletados.reduce((min,p) => p.tiempoSeleccion<min.tiempoSeleccion? p : min, this.procesosCompletados[0]);
    const ultimaLiber = this.procesosCompletados.reduce((max,p) => p.tiempoLiberacion> max.tiempoLiberacion? p:max, this.procesosCompletados[0]);
    const trT= (ultimaLiber.tiempoLiberacion - (primerSelec.tiempoSeleccion - this.tiempoSeleccion));
    return trT;
  }

  /*------------ CICLO PRINCIPAL ------------*/
    ejecutarTick() {
        this.terminadosEstados();
        this.liberacion(); 
        this.terminadosEstados();// caso 0  de liberacion
        this.cargar_memoria();
        this.nuevoAts();
        this.terminadosEstados();
        this.tsAtc();
        this.terminadosEstados();
        this.cargar_memoria(); //caso 0 de TS y TC
        this.GuardarTick();
        this.fragmentacionExternaAcumulada += this.calculoFragExt();
        this.tiempoActual++;
    }
}
