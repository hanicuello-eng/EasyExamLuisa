// ==========================================
// CONFIGURACIÓN E INICIALIZACIÓN DE FIREBASE
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyBYHugEvq7QKlZax5qNa0LW07qbeAdJNz4",
  authDomain: "facil-evaluacion.firebaseapp.com",
  databaseURL: "https://facil-evaluacion-default-rtdb.firebaseio.com",
  projectId: "facil-evaluacion",
  storageBucket: "facil-evaluacion.firebasestorage.app",
  messagingSenderId: "522162702804",
  appId: "1:522162702804:web:405adbdf1e6727a1712e41"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const database = firebase.database();

// Variables globales
let registeredGroups = [];
let registeredStudents = [];
let registeredTeachers = [];
let examsBank = [];
let currentExamQuestions = [];
let currentEditingExamId = null;
let selectedGroupForView = null;

let currentTeacher = null; 
let editingQuestionIndex = null;

// Variables de sesión del Estudiante
let activeStudentExam = null;
let currentStudentData = { name: "", group: "" };
let examTimerInterval = null;
let examStartTime = null;
let tabSwitchCount = 0;

// Detectar automáticamente al cargar la página si viene un link de examen (?exam=ID)
window.onload = function() {
  cargarDatosDocente();
  
  const urlParams = new URLSearchParams(window.location.search);
  const examIdParam = urlParams.get('exam');

  if (examIdParam) {
    iniciarModuloEstudiante(examIdParam);
  }
};

// ==========================================
// MÓDULO DEL ESTUDIANTE (LÓGICA Y TIEMPO REAL)
// ==========================================
function iniciarModuloEstudiante(examId) {
  document.getElementById('loginModule').classList.add('hidden');
  document.getElementById('teacherModule').classList.add('hidden');
  document.getElementById('studentModule').classList.remove('hidden');

  database.ref("examenes/" + examId).once("value", snapshot => {
    activeStudentExam = snapshot.val();
    if (!activeStudentExam) {
      alert("El examen no existe o fue eliminado.");
      return;
    }
    activeStudentExam.id = examId;

    document.getElementById('studentExamTitleDisplay').innerText = activeStudentExam.title;
    document.getElementById('studentExamMetaDisplay').innerText = `Tiempo límite: ${activeStudentExam.timeLimit} minutos`;

    // Cargar selector de grupos del estudiante
    const groupSelect = document.getElementById('studentGroupSelect');
    groupSelect.innerHTML = '<option value="">-- Seleccionar Grupo --</option>';
    
    database.ref("grupos").once("value", groupSnap => {
      groupSnap.forEach(child => {
        const gName = child.val();
        groupSelect.innerHTML += `<option value="${gName}">${gName}</option>`;
      });
    });
  });

  // Anti-cheat: detectar si cambia de pestaña
  document.addEventListener("visibilitychange", function() {
    if (document.hidden && activeStudentExam && !document.getElementById('studentQuizCard').classList.contains('hidden')) {
      tabSwitchCount++;
      alert(`⚠️ ADVERTENCIA ANTI-CHEAT: Has salido de la pestaña del examen (${tabSwitchCount} vez/veces). Esta acción queda registrada para el docente.`);
    }
  });
}

// Registro e Inicio del examen por el estudiante
const studentRegForm = document.getElementById('studentRegisterForm');
if (studentRegForm) {
  studentRegForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const name = document.getElementById('studentNameInput').value.trim();
    const group = document.getElementById('studentGroupSelect').value;

    if (!name || !group) {
      alert("Por favor completa tu nombre y selecciona tu grupo.");
      return;
    }

    currentStudentData = { name, group };
    
    // Guardar automáticamente al estudiante si no existe
    database.ref("estudiantes").push({ name, group, registeredAt: Date.now() });

    document.getElementById('studentStartCard').classList.add('hidden');
    document.getElementById('studentQuizCard').classList.remove('hidden');

    renderizarExamenEstudiante();
  });
}

function renderizarExamenEstudiante() {
  document.getElementById('quizTitle').innerText = activeStudentExam.title;
  document.getElementById('quizStudentName').innerText = `Estudiante: ${currentStudentData.name} | Grupo: ${currentStudentData.group}`;

  const mediaContainer = document.getElementById('quizMediaContainer');
  mediaContainer.innerHTML = "";
  if (activeStudentExam.mediaUrl) {
    mediaContainer.innerHTML = `<img src="${activeStudentExam.mediaUrl}" alt="Recurso del Examen">`;
  }

  // Preparar preguntas (Aleatoriedad si aplica)
  let preguntasAmostrar = activeStudentExam.questions ? [...activeStudentExam.questions] : [];
  if (activeStudentExam.randomCount > 0 && activeStudentExam.randomCount < preguntasAmostrar.length) {
    preguntasAmostrar = preguntasAmostrar.sort(() => 0.5 - Math.random()).slice(0, activeStudentExam.randomCount);
  }

  activeStudentExam.activeQuestionsRendered = preguntasAmostrar;

  const questionsContainer = document.getElementById('quizQuestionsContainer');
  questionsContainer.innerHTML = "";

  preguntasAmostrar.forEach((q, idx) => {
    let optionsHtml = "";
    if (q.type === 'multiple' && q.options) {
      q.options.forEach((optText, optIdx) => {
        optionsHtml += `
          <label class="option-radio-label">
            <input type="radio" name="student_q_${idx}" value="${optIdx}" required>
            <span>${optText}</span>
          </label>
        `;
      });
    } else {
      optionsHtml = `<textarea name="student_q_${idx}" placeholder="Escribe tu respuesta detallada aquí..." required style="min-height: 80px;"></textarea>`;
    }

    questionsContainer.innerHTML += `
      <div class="question-item-card">
        <p class="question-item-title">${idx + 1}. ${q.text} <small style="color: var(--text-muted); font-weight: normal;">(${q.points || 1} pts)</small></p>
        ${optionsHtml}
      </div>
    `;
  });

  // Iniciar Cronómetro
  examStartTime = Date.now();
  let timeInSeconds = (activeStudentExam.timeLimit || 30) * 60;
  const timerDisplay = document.getElementById('timeRemaining');

  examTimerInterval = setInterval(() => {
    timeInSeconds--;
    let mins = Math.floor(timeInSeconds / 60);
    let secs = timeInSeconds % 60;
    timerDisplay.innerText = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;

    if (timeInSeconds <= 0) {
      clearInterval(examTimerInterval);
      alert("⏱️ ¡El tiempo del examen ha finalizado! Se enviarán tus respuestas actuales.");
      finalizarExamenEstudiante();
    }
  }, 1000);
}

// Envío y Evaluación del Examen
const quizFormEl = document.getElementById('quizForm');
if (quizFormEl) {
  quizFormEl.addEventListener('submit', function(e) {
    e.preventDefault();
    if (confirm("¿Estás seguro de enviar tu examen?")) {
      finalizarExamenEstudiante();
    }
  });
}

function finalizarExamenEstudiante() {
  if (examTimerInterval) clearInterval(examTimerInterval);

  let puntajeObtenido = 0;
  let puntajeTotal = 0;
  let preguntasCorrectasCount = 0;
  let totalPreguntas = activeStudentExam.activeQuestionsRendered.length;
  let respuestasDetalle = [];

  activeStudentExam.activeQuestionsRendered.forEach((q, idx) => {
    const valMax = q.points || 1;
    puntajeTotal += valMax;

    let resEstudiante = null;
    let esCorrecta = false;
    let puntosAportados = 0;

    if (q.type === 'multiple') {
      const radioChecked = document.querySelector(`input[name="student_q_${idx}"]:checked`);
      if (radioChecked) {
        resEstudiante = parseInt(radioChecked.value);
        if (resEstudiante === q.correctIndex) {
          esCorrecta = true;
          puntosAportados = valMax;
          puntajeObtenido += valMax;
          preguntasCorrectasCount++;
        }
      }
    } else {
      const textAns = document.querySelector(`textarea[name="student_q_${idx}"]`);
      resEstudiante = textAns ? textAns.value.trim() : "";
    }

    respuestasDetalle.push({
      enunciado: q.text,
      respuesta: resEstudiante,
      esCorrecta: esCorrecta,
      puntuacionAportada: puntosAportados
    });
  });

  const resultadoData = {
    examId: activeStudentExam.id,
    studentName: currentStudentData.name,
    studentGroup: currentStudentData.group,
    puntajeObtenido: puntajeObtenido,
    puntajeTotal: puntajeTotal,
    preguntasCorrectas: preguntasCorrectasCount,
    totalPreguntas: totalPreguntas,
    startTime: examStartTime,
    fecha: Date.now(),
    tabSwitchCount: tabSwitchCount,
    respuestas: respuestasDetalle
  };

  // Guardar en Firebase
  database.ref("resultados").push(resultadoData)
    .then(() => {
      document.getElementById('studentQuizCard').classList.add('hidden');
      document.getElementById('studentResultCard').classList.remove('hidden');

      // Mostrar únicamente métricas generales
      document.getElementById('resScore').innerText = `${puntajeObtenido} / ${puntajeTotal}`;
      document.getElementById('resCorrectCount').innerText = `${preguntasCorrectasCount} de ${totalPreguntas}`;
    })
    .catch(err => alert("Error al guardar respuestas: " + err.message));
}

// ==========================================
// NAVEGACIÓN Y LOGOUT DOCENTE
// ==========================================
function switchTab(tabId) {
  const tabs = document.querySelectorAll('.tab-content');
  tabs.forEach(tab => {
    tab.classList.add('hidden-tab');
    tab.classList.remove('active-tab');
  });

  const navBtns = document.querySelectorAll('.sidebar-nav .nav-btn');
  navBtns.forEach(btn => btn.classList.remove('active'));

  const targetTab = document.getElementById(tabId);
  if (targetTab) {
    targetTab.classList.remove('hidden-tab');
    targetTab.classList.add('active-tab');
  }

  if (typeof event !== 'undefined' && event && event.target) {
    const btnTarget = event.target.closest('.nav-btn');
    if (btnTarget) btnTarget.classList.add('active');
  }
}

function logoutTeacher() {
  const teacherMod = document.getElementById('teacherModule');
  const loginMod = document.getElementById('loginModule');
  const teacherForm = document.getElementById('teacherLoginForm');

  currentTeacher = null;
  if (teacherMod) teacherMod.classList.add('hidden');
  if (loginMod) loginMod.classList.remove('hidden');
  if (teacherForm) teacherForm.reset();
}

// ==========================================
// GESTIÓN DE GRUPOS Y VISUALIZACIÓN DE INTEGRANTES
// ==========================================
function addGroup() {
  const input = document.getElementById('newGroupNameInput');
  if (!input) return;
  const groupName = input.value.trim();

  if (!groupName) {
    alert("Por favor ingresa un nombre para el grupo.");
    return;
  }

  if (registeredGroups.includes(groupName)) {
    alert("Este grupo ya existe.");
    return;
  }

  database.ref("grupos").push(groupName)
    .then(() => {
      input.value = "";
      alert("Grupo agregado exitosamente.");
    })
    .catch(error => alert("Error al agregar grupo: " + error.message));
}

function deleteGroup(groupKey) {
  if (confirm("¿Estás segura de eliminar este grupo?")) {
    database.ref("grupos/" + groupKey).remove()
      .then(() => {
        alert("Grupo eliminado.");
        if (selectedGroupForView) {
          selectedGroupForView = null;
          document.getElementById('groupMembersTitle').innerText = "Integrantes del Grupo";
          document.getElementById('groupMembersContainer').innerHTML = `<p class="empty-state">Selecciona un grupo de la izquierda para ver sus estudiantes.</p>`;
        }
      })
      .catch(error => alert("Error al eliminar: " + error.message));
  }
}

// Escuchar cambios en grupos en tiempo real
database.ref("grupos").on("value", snapshot => {
  registeredGroups = [];
  const container = document.getElementById('groupsListContainer');
  if (container) container.innerHTML = "";

  snapshot.forEach(childSnap => {
    const key = childSnap.key;
    const groupName = childSnap.val();
    registeredGroups.push(groupName);

    if (container) {
      const isSelected = selectedGroupForView === groupName ? 'background: #F4EFEA; border-color: #8C6D58;' : 'background: #fff; border-color: #EAE3D9;';
      container.innerHTML += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-radius: 8px; border: 1px solid #ddd; ${isSelected} cursor: pointer;" onclick="seleccionarGrupoParaVer('${groupName}')">
          <span style="font-weight: 600; font-size: 0.9rem;">📚 ${groupName}</span>
          <button type="button" class="btn-danger-sm" onclick="event.stopPropagation(); deleteGroup('${key}')">Eliminar</button>
        </div>
      `;
    }
  });

  updateExamGroupSelect();
});

function seleccionarGrupoParaVer(groupName) {
  selectedGroupForView = groupName;
  document.getElementById('groupMembersTitle').innerText = `Integrantes de: ${groupName}`;
  
  database.ref("grupos").once("value", snapshot => {
    const container = document.getElementById('groupsListContainer');
    if (container) container.innerHTML = "";
    snapshot.forEach(childSnap => {
      const key = childSnap.key;
      const gName = childSnap.val();
      const isSelected = selectedGroupForView === gName ? 'background: #F4EFEA; border-color: #8C6D58;' : 'background: #fff; border-color: #EAE3D9;';
      container.innerHTML += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-radius: 8px; border: 1px solid #ddd; ${isSelected} cursor: pointer;" onclick="seleccionarGrupoParaVer('${gName}')">
          <span style="font-weight: 600; font-size: 0.9rem;">📚 ${gName}</span>
          <button type="button" class="btn-danger-sm" onclick="event.stopPropagation(); deleteGroup('${key}')">Eliminar</button>
        </div>
      `;
    });
  });

  cargarIntegrantesGrupo(groupName);
}

function cargarIntegrantesGrupo(groupName) {
  const container = document.getElementById('groupMembersContainer');
  if (!container) return;

  container.innerHTML = `<p style="color: #666; font-style: italic;">Cargando estudiantes del grupo ${groupName}...</p>`;

  const estudiantesDelGrupo = registeredStudents.filter(s => s.group === groupName);

  if (estudiantesDelGrupo.length === 0) {
    container.innerHTML = `<p class="empty-state">No hay estudiantes registrados en este grupo todavía.</p>`;
    return;
  }

  let html = `<ul style="list-style-type: none; padding: 0; margin: 0;">`;
  estudiantesDelGrupo.forEach((est) => {
    html += `
      <li style="padding: 10px; margin-bottom: 8px; background: #fff; border: 1px solid #EAE3D9; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 0.9rem;">👤 <strong>${est.name}</strong></span>
        <span style="font-size: 0.78rem; color: #6B9080; background: #E8F0EC; padding: 3px 8px; border-radius: 6px; font-weight: 700;">Inscrito</span>
      </li>
    `;
  });
  html += `</ul>`;
  container.innerHTML = html;
}

function updateExamGroupSelect() {
  const select = document.getElementById('examGroupSelect');
  if (!select) return;
  select.innerHTML = `
    <option value="">-- Seleccionar Asignación --</option>
    <option value="General">🌐 General (Todos los estudiantes)</option>
  `;
  registeredGroups.forEach(group => {
    select.innerHTML += `<option value="${group}">${group}</option>`;
  });
}

// ==========================================
// REGISTRO DE ESTUDIANTES Y DOCENTES
// ==========================================
database.ref("estudiantes").on("value", snapshot => {
  registeredStudents = [];
  snapshot.forEach(childSnap => {
    registeredStudents.push({
      id: childSnap.key,
      ...childSnap.val()
    });
  });

  if (selectedGroupForView) {
    cargarIntegrantesGrupo(selectedGroupForView);
  }
});

database.ref("docentes").on("value", snapshot => {
  registeredTeachers = [];
  snapshot.forEach(childSnap => {
    registeredTeachers.push({
      id: childSnap.key,
      ...childSnap.val()
    });
  });
});

function registerNewTeacher() {
  const nameInput = prompt("Registro de Docente\n\nIngresa tu nombre completo:");
  if (!nameInput || nameInput.trim() === "") return;

  const exists = registeredTeachers.some(t => t.name.toLowerCase() === nameInput.trim().toLowerCase());
  if (exists || nameInput.trim().toLowerCase() === "luisa arango") {
    alert("Este nombre ya está registrado o pertenece al administrador principal.");
    return;
  }

  const subjectInput = prompt("¿Qué materia o asignatura impartes?");
  if (!subjectInput || subjectInput.trim() === "") {
    alert("La materia es obligatoria. Registro cancelado.");
    return;
  }

  const passInput = prompt("Crea una contraseña personal para tus ingresos futuros:");
  if (!passInput || passInput.trim() === "") {
    alert("La contraseña no puede estar vacía. Registro cancelado.");
    return;
  }

  const newTeacher = {
    name: nameInput.trim(),
    subject: subjectInput.trim(),
    pass: passInput.trim()
  };

  database.ref("docentes").push(newTeacher)
    .then(() => {
      alert(`¡Registro exitoso, Prof. ${newTeacher.name}! Ya puedes iniciar sesión.`);
    })
    .catch((error) => {
      alert("Error al registrar docente en línea: " + error.message);
    });
}

// ==========================================
// BANCO Y CREADOR DE EXÁMENES EN BLOQUES/CARDS
// ==========================================
database.ref("examenes").on("value", snapshot => {
  examsBank = [];
  const container = document.getElementById('examsBankContainer');
  const historySelect = document.getElementById('historyExamFilter');
  
  if (container) container.innerHTML = "";
  if (historySelect) historySelect.innerHTML = '<option value="">-- Seleccionar Examen --</option>';

  snapshot.forEach(childSnap => {
    const key = childSnap.key;
    const exam = childSnap.val();
    exam.id = key;
    examsBank.push(exam);
  });

  // Ordenar exámenes por fecha de creación (los más recientes primero)
  examsBank.reverse();

  if (container) {
    if (examsBank.length === 0) {
      container.innerHTML = `
        <div class="empty-exams-state">
          <span>📭</span>
          <p>Aún no has creado ningún examen.</p>
          <button class="btn btn-primary btn-sm" onclick="openExamCreator()">+ Crear el primero</button>
        </div>
      `;
    } else {
      examsBank.forEach(exam => {
        const deadlineText = exam.deadline ? new Date(exam.deadline).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Sin límite';
        const totalPreguntas = exam.questions ? exam.questions.length : 0;
        const isGeneral = exam.group === "General" || !exam.group;
        const badgeClass = isGeneral ? "badge-group badge-general" : "badge-group";
        const groupText = isGeneral ? "🌐 General" : `👥 ${exam.group}`;

        container.innerHTML += `
          <div class="exam-card-block">
            <div class="exam-card-header">
              <span class="${badgeClass}">${groupText}</span>
              <span class="badge-time">⏱️ ${exam.timeLimit} min</span>
            </div>
            
            <h3 class="exam-card-title">${exam.title}</h3>
            
            <div class="exam-card-info">
              <div class="info-item">
                <span class="info-label">Preguntas:</span>
                <span class="info-val">${totalPreguntas} ${exam.randomCount > 0 ? `(${exam.randomCount} aleatorias)` : ''}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Vence:</span>
                <span class="info-val">${deadlineText}</span>
              </div>
            </div>

            <div class="exam-card-actions">
              <button class="btn-card-action" onclick="abrirVistaPrevia('${exam.id}')" title="Vista Previa">👁️ Previa</button>
              <button class="btn-card-action" onclick="editarExamen('${exam.id}')" title="Editar Examen">✏️ Editar</button>
              <button class="btn-card-action" onclick="abrirCompartirExamen('${exam.id}')" title="Compartir enlace / QR">🔗 Compartir</button>
              <button class="btn-card-action" onclick="verRespuestasRecibidas('${exam.id}')" title="Ver entregas">📥 Respuestas</button>
              <button class="btn-card-action btn-delete-card" onclick="deleteExam('${exam.id}')" title="Eliminar Examen">🗑️</button>
            </div>
          </div>
        `;
      });
    }
  }

  if (historySelect) {
    examsBank.forEach(exam => {
      historySelect.innerHTML += `<option value="${exam.id}">${exam.title} (${exam.group || 'General'})</option>`;
    });
  }
});

function openExamCreator() {
  currentEditingExamId = null;
  currentExamQuestions = [];
  editingQuestionIndex = null;
  document.getElementById('creatorTitle').innerText = "Nuevo Examen";
  document.getElementById('examTitleInput').value = "";
  document.getElementById('examGroupSelect').value = "General";
  document.getElementById('examTimeInput').value = "30";
  
  if (document.getElementById('examMediaInput')) document.getElementById('examMediaInput').value = "";
  if (document.getElementById('examRandomCountInput')) document.getElementById('examRandomCountInput').value = "0";
  if (document.getElementById('examDeadlineInput')) document.getElementById('examDeadlineInput').value = "";

  document.getElementById('currentExamQuestionsList').innerHTML = "";
  resetQuestionForm();
  
  document.getElementById('examsBankSection').classList.add('hidden');
  document.getElementById('examCreatorSection').classList.remove('hidden');
  toggleOptionFields();
}

function closeExamCreator() {
  document.getElementById('examCreatorSection').classList.add('hidden');
  document.getElementById('examsBankSection').classList.remove('hidden');
}

function toggleOptionFields() {
  const type = document.getElementById('newQuestionType').value;
  const block = document.getElementById('multipleOptionsBlock');
  if (type === 'multiple') {
    block.classList.remove('hidden');
    if (document.getElementById('dynamicOptionsContainer').innerHTML === "") {
      addOptionField();
      addOptionField();
    }
  } else {
    block.classList.add('hidden');
  }
}

function addOptionField(textValue = "") {
  const container = document.getElementById('dynamicOptionsContainer');
  const index = container.children.length;
  const div = document.createElement('div');
  div.style.cssText = "display: flex; gap: 8px; margin-bottom: 8px; align-items: center;";
  div.innerHTML = `
    <input type="radio" name="correctOptionRadio" value="${index}">
    <input type="text" placeholder="Opción ${index + 1}" class="option-text-input" style="flex: 1;" value="${textValue}">
    <button type="button" class="btn-danger-sm" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(div);
}

function resetQuestionForm() {
  editingQuestionIndex = null;
  document.getElementById('newQuestionText').value = "";
  document.getElementById('newQuestionType').value = "multiple";
  document.getElementById('newQuestionPoints').value = "1";
  document.getElementById('dynamicOptionsContainer').innerHTML = "";
  toggleOptionFields();
  const addBtn = document.getElementById('addQuestionBtn');
  if (addBtn) addBtn.innerText = "➕ Agregar Pregunta al Examen";
}

function addQuestionToCurrentExam() {
  const text = document.getElementById('newQuestionText').value.trim();
  const type = document.getElementById('newQuestionType').value;
  const points = parseFloat(document.getElementById('newQuestionPoints').value) || 1;

  if (!text) {
    alert("Escribe el enunciado de la pregunta.");
    return;
  }

  let questionObj = { text, type, points };

  if (type === 'multiple') {
    const optionInputs = document.querySelectorAll('.option-text-input');
    const radios = document.querySelectorAll('input[name="correctOptionRadio"]');
    let options = [];
    let correctIndex = -1;

    optionInputs.forEach((input, idx) => {
      options.push(input.value.trim());
      if (radios[idx].checked) {
        correctIndex = idx;
      }
    });

    if (options.some(opt => opt === "")) {
      alert("Todas las opciones deben tener texto.");
      return;
    }

    if (correctIndex === -1) {
      alert("Debes marcar cuál opción es la correcta.");
      return;
    }

    questionObj.options = options;
    questionObj.correctIndex = correctIndex;
  }

  if (editingQuestionIndex !== null) {
    currentExamQuestions[editingQuestionIndex] = questionObj;
    alert("Pregunta actualizada con éxito.");
  } else {
    currentExamQuestions.push(questionObj);
  }

  renderCurrentExamQuestions();
  resetQuestionForm();
}

function editarPreguntaActual(index) {
  const q = currentExamQuestions[index];
  if (!q) return;

  editingQuestionIndex = index;
  document.getElementById('newQuestionText').value = q.text;
  document.getElementById('newQuestionType').value = q.type;
  document.getElementById('newQuestionPoints').value = q.points;

  toggleOptionFields();

  if (q.type === 'multiple') {
    const container = document.getElementById('dynamicOptionsContainer');
    container.innerHTML = "";
    q.options.forEach((optText) => {
      addOptionField(optText);
    });

    const radios = document.querySelectorAll('input[name="correctOptionRadio"]');
    if (radios[q.correctIndex]) {
      radios[q.correctIndex].checked = true;
    }
  }

  const addBtn = document.getElementById('addQuestionBtn');
  if (addBtn) addBtn.innerText = "💾 Guardar Cambios de Pregunta";
  
  document.getElementById('newQuestionText').scrollIntoView({ behavior: 'smooth' });
}

function renderCurrentExamQuestions() {
  const list = document.getElementById('currentExamQuestionsList');
  list.innerHTML = "";
  currentExamQuestions.forEach((q, idx) => {
    list.innerHTML += `
      <div style="background: #F7F4EE; padding: 12px; margin-bottom: 8px; border-radius: 8px; border: 1px solid #EAE3D9; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>Pregunta ${idx + 1} (${q.points} pts):</strong> ${q.text} [${q.type}]
        </div>
        <div style="display: flex; gap: 6px;">
          <button type="button" class="btn-secondary-sm" onclick="editarPreguntaActual(${idx})">✏️ Editar</button>
          <button type="button" class="btn-danger-sm" onclick="currentExamQuestions.splice(${idx},1); renderCurrentExamQuestions();">Eliminar</button>
        </div>
      </div>
    `;
  });
}

function saveExamToBank() {
  const title = document.getElementById('examTitleInput').value.trim();
  const group = document.getElementById('examGroupSelect').value || "General";
  const timeLimit = parseInt(document.getElementById('examTimeInput').value) || 30;
  
  const mediaUrl = document.getElementById('examMediaInput') ? document.getElementById('examMediaInput').value.trim() : "";
  const randomCount = parseInt(document.getElementById('examRandomCountInput') ? document.getElementById('examRandomCountInput').value : 0) || 0;
  const deadline = document.getElementById('examDeadlineInput') ? document.getElementById('examDeadlineInput').value : "";

  if (!title) {
    alert("El examen debe tener un título.");
    return;
  }
  if (!group) {
    alert("Selecciona la asignación del examen.");
    return;
  }
  if (currentExamQuestions.length === 0) {
    alert("Agrega al menos una pregunta al examen.");
    return;
  }

  if (randomCount > currentExamQuestions.length) {
    alert(`Has configurado ${randomCount} preguntas aleatorias, pero el banco solo tiene ${currentExamQuestions.length}. Ajusta este valor.`);
    return;
  }

  const examData = { 
    title, 
    group, 
    timeLimit, 
    mediaUrl, 
    randomCount, 
    deadline,
    createdAt: Date.now(),
    questions: currentExamQuestions 
  };

  let dbRef = database.ref("examenes");
  if (currentEditingExamId) {
    dbRef.child(currentEditingExamId).set(examData)
      .then(() => {
        alert("Examen actualizado con éxito.");
        closeExamCreator();
      });
  } else {
    dbRef.push(examData)
      .then(() => {
        alert("Examen guardado en el banco.");
        closeExamCreator();
      });
  }
}

function deleteExam(key) {
  if (confirm("¿Estás seguro de eliminar este examen del banco?")) {
    database.ref("examenes/" + key.trim()).remove()
      .then(() => alert("Examen eliminado."));
  }
}

// ==========================================
// LOGIN DOCENTE
// ==========================================
const teacherFormEl = document.getElementById('teacherLoginForm');
if (teacherFormEl) {
  teacherFormEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('loginTeacherUser').value.trim();
    const pass = document.getElementById('loginTeacherPass').value.trim();

    if (user === "Luisa Arango" && pass === "1234") {
      iniciarSesionDocenteExitoso({ name: "Luisa Arango", subject: "General" });
      return;
    }

    const foundTeacher = registeredTeachers.find(t => t.name.toLowerCase() === user.toLowerCase() && t.pass === pass);

    if (foundTeacher) {
      iniciarSesionDocenteExitoso(foundTeacher);
    } else {
      alert("Usuario o contraseña de docente incorrectos.");
    }
  });
}

function iniciarSesionDocenteExitoso(teacherObj) {
  currentTeacher = teacherObj;
  const loginMod = document.getElementById('loginModule');
  const teacherMod = document.getElementById('teacherModule');
  if (loginMod) loginMod.classList.add('hidden');
  if (teacherMod) teacherMod.classList.remove('hidden');

  const welcomeTeacherEl = document.getElementById('teacherWelcomeName');
  if (welcomeTeacherEl) welcomeTeacherEl.innerText = teacherObj.name;

  cargarDatosDocente();
}

// ==========================================
// CONFIGURACIÓN Y PERFIL DEL DOCENTE
// ==========================================
function cargarDatosDocente() {
  database.ref("configuracionDocente").on("value", snapshot => {
    const config = snapshot.val();
    if (config) {
      if (document.getElementById('profNameInput')) document.getElementById('profNameInput').value = config.name || "";
      if (document.getElementById('profPassInput')) document.getElementById('profPassInput').value = config.pass || "";
      if (document.getElementById('profSubjectInput')) document.getElementById('profSubjectInput').value = config.subject || "";
      if (document.getElementById('profBioInput')) document.getElementById('profBioInput').value = config.bio || "";
      if (config.avatar && document.getElementById('avatarImage')) {
        document.getElementById('avatarImage').src = config.avatar;
      }
    }
  });
}

function updateProfile() {
  const name = document.getElementById('profNameInput') ? document.getElementById('profNameInput').value.trim() : "";
  const pass = document.getElementById('profPassInput') ? document.getElementById('profPassInput').value.trim() : "";
  const subject = document.getElementById('profSubjectInput') ? document.getElementById('profSubjectInput').value.trim() : "";
  const bio = document.getElementById('profBioInput') ? document.getElementById('profBioInput').value.trim() : "";
  const avatarImg = document.getElementById('avatarImage');
  const avatar = avatarImg ? avatarImg.src : "";

  const teacherConfig = { name, pass, subject, bio, avatar };

  database.ref("configuracionDocente").set(teacherConfig)
    .then(() => {
      console.log("Perfil actualizado correctamente en Firebase.");
    })
    .catch(error => {
      alert("Error al actualizar el perfil: " + error.message);
    });
}

const avatarInputEl = document.getElementById('avatarInput');
if (avatarInputEl) {
  avatarInputEl.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(event) {
        const base64Image = event.target.result;
        document.getElementById('avatarImage').src = base64Image;
        updateProfile(); 
      };
      reader.readAsDataURL(file);
    }
  });
}

// ==========================================
// VISTA PREVIA, COMPARTIR Y RESPUESTAS
// ==========================================
function abrirVistaPrevia(examId) {
  const examen = examsBank.find(e => e.id === examId);
  if (!examen) {
    alert("No se encontró el examen para la vista previa.");
    return;
  }

  const container = document.getElementById("previewContentContainer");
  if (!container) return;

  container.innerHTML = `
    <h3 style="color: #2C2523; margin-bottom: 5px;">${examen.title} (Simulacro)</h3>
    <p style="color: #7A706A; font-size: 0.85rem; margin-bottom: 15px;">Alcance: ${examen.group || 'General'} | Tiempo: ${examen.timeLimit} min</p>
    <hr style="border: 0; border-top: 1px solid #EAE3D9; margin-bottom: 15px;">
  `;

  if (examen.mediaUrl) {
    container.innerHTML += `<div style="margin-bottom: 15px;"><img src="${examen.mediaUrl}" style="max-width: 100%; border-radius: 8px;" alt="Multimedia"></div>`;
  }

  if (examen.questions && examen.questions.length > 0) {
    examen.questions.forEach((q, index) => {
      let opcionesHtml = '';
      if (q.type === 'multiple' && q.options) {
        q.options.forEach((opt, oIndex) => {
          opcionesHtml += `
            <div style="margin: 6px 0;">
              <label><input type="radio" name="preview_q_${index}" value="${oIndex}"> ${opt}</label>
            </div>`;
        });
      } else {
        opcionesHtml = `<textarea style="width:100%; margin-top:5px; padding:8px;" placeholder="Respuesta abierta de prueba..."></textarea>`;
      }

      container.innerHTML += `
        <div style="background: #F7F4EE; padding: 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #EAE3D9;">
          <p style="font-weight: bold; margin-bottom: 8px;">${index + 1}. ${q.text} <span style="font-size:0.8rem; color:#7A706A;">(${q.points || 1} pts)</span></p>
          ${opcionesHtml}
        </div>
      `;
    });
  } else {
    container.innerHTML += `<p class="empty-state">Este examen no tiene preguntas agregadas aún.</p>`;
  }

  document.getElementById("previewModal").classList.remove("hidden");
}

function closePreviewModal() {
  document.getElementById("previewModal").classList.add("hidden");
}

function abrirCompartirExamen(examId) {
  const modal = document.getElementById("shareModal");
  const qrContainer = document.getElementById("qrcodeContainer");
  const linkInput = document.getElementById("shareLinkInput");

  if (!modal || !qrContainer || !linkInput) return;

  qrContainer.innerHTML = "";
  const urlExamen = window.location.href.split('#')[0] + "?exam=" + examId;
  linkInput.value = urlExamen;

  modal.classList.remove("hidden");

  new QRCode(qrContainer, {
    text: urlExamen,
    width: 180,
    height: 180,
    colorDark: "#2C2523",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
}

function closeShareModal() {
  document.getElementById("shareModal").classList.add("hidden");
}

function copyShareLink() {
  const linkInput = document.getElementById("shareLinkInput");
  if (!linkInput) return;
  linkInput.select();
  linkInput.setSelectionRange(0, 99999);
  document.execCommand("copy");
  alert("¡Enlace copiado al portapapeles!");
}

function editarExamen(examId) {
  const examen = examsBank.find(e => e.id === examId);
  if (!examen) return;

  currentEditingExamId = examId;

  document.getElementById("examsBankSection").classList.add("hidden");
  document.getElementById("examCreatorSection").classList.remove("hidden");
  document.getElementById("creatorTitle").innerText = "Editar Examen";

  document.getElementById("examTitleInput").value = examen.title || "";
  document.getElementById("examGroupSelect").value = examen.group || "General";
  document.getElementById("examTimeInput").value = examen.timeLimit || 30;
  
  if (document.getElementById("examMediaInput")) {
    document.getElementById("examMediaInput").value = examen.mediaUrl || "";
  }
  if (document.getElementById("examRandomCountInput")) {
    document.getElementById("examRandomCountInput").value = examen.randomCount || 0;
  }
  if (document.getElementById("examDeadlineInput")) {
    document.getElementById("examDeadlineInput").value = examen.deadline || "";
  }

  currentExamQuestions = examen.questions ? [...examen.questions] : [];
  renderCurrentExamQuestions();
}

function verRespuestasRecibidas(examId) {
  const examen = examsBank.find(e => e.id === examId);
  const modal = document.getElementById("responsesModal");
  const container = document.getElementById("responsesListContainer");
  const title = document.getElementById("responsesModalTitle");

  if (!modal || !container || !title) return;

  title.innerText = `📥 Respuestas Recibidas: ${examen ? examen.title : ''}`;
  container.innerHTML = `<p style="color: #7A706A; font-style: italic;">Cargando entregas de los estudiantes...</p>`;
  modal.classList.remove("hidden");

  database.ref('resultados').orderByChild('examId').equalTo(examId).once('value')
    .then(snapshot => {
      const data = snapshot.val();
      if (!data) {
        container.innerHTML = `<p class="empty-state" style="text-align: center; padding: 20px;">Aún no hay estudiantes que hayan entregado este examen.</p>`;
        return;
      }

      let html = `<table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
        <thead>
          <tr style="background: #F7F4EE; border-bottom: 2px solid #EAE3D9;">
            <th style="padding: 10px; text-align: left;">Estudiante</th>
            <th style="padding: 10px; text-align: center;">Grupo</th>
            <th style="padding: 10px; text-align: center;">Calificación</th>
            <th style="padding: 10px; text-align: center;">Fecha</th>
          </tr>
        </thead>
        <tbody>`;

      Object.values(data).forEach(res => {
        const fechaFormateada = res.fecha ? new Date(res.fecha).toLocaleString() : 'Reciente';
        html += `
          <tr style="border-bottom: 1px solid #EAE3D9;">
            <td style="padding: 10px;">${res.studentName || 'Anónimo'}</td>
            <td style="padding: 10px; text-align: center; color: #7A706A;">${res.studentGroup || '-'}</td>
            <td style="padding: 10px; text-align: center; font-weight: bold; color: #6B9080;">${res.puntajeObtenido} / ${res.puntajeTotal}</td>
            <td style="padding: 10px; text-align: center; color: #7A706A; font-size: 0.8rem;">${fechaFormateada}</td>
          </tr>`;
      });

      html += `</tbody></table>`;
      container.innerHTML = html;
    })
    .catch(error => {
      container.innerHTML = `<p style="color: #E07A5F;">Error al cargar las respuestas: ${error.message}</p>`;
    });
}

function closeResponsesModal() {
  document.getElementById("responsesModal").classList.add("hidden");
}

// ==========================================
// HISTORIAL Y REPORTES EXCEL
// ==========================================
const historyFilterEl = document.getElementById('historyExamFilter');
if (historyFilterEl) {
  historyFilterEl.addEventListener('change', function() {
    cargarHistorialExamen(this.value);
  });
}

function cargarHistorialExamen(examId) {
  const container = document.getElementById('historyListContainer');
  if (!container) return;

  if (!examId) {
    container.innerHTML = `<p class="empty-state">Selecciona un examen arriba para ver su historial y opciones de descarga.</p>`;
    return;
  }

  container.innerHTML = `<p style="color: #7A706A;">Cargando resultados...</p>`;

  database.ref("resultados").orderByChild("examId").equalTo(examId).once("value", snapshot => {
    const resultados = [];
    snapshot.forEach(child => {
      resultados.push({
        id: child.key,
        ...child.val()
      });
    });

    if (resultados.length === 0) {
      container.innerHTML = `<p class="empty-state" style="text-align: center; padding: 20px;">Aún no hay estudiantes que hayan presentado este examen.</p>`;
      return;
    }

    let html = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
        <h4 style="margin: 0; color: #2C2523;">Total de Evaluados: ${resultados.length}</h4>
        <button class="btn btn-primary" onclick="descargarExcelGeneral('${examId}')" style="background-color: #6B9080;">📥 Descargar Reporte General (Excel)</button>
      </div>
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
          <thead>
            <tr style="background: #F7F4EE; border-bottom: 2px solid #EAE3D9;">
              <th style="padding: 10px; text-align: left;">Estudiante</th>
              <th style="padding: 10px; text-align: center;">Grupo</th>
              <th style="padding: 10px; text-align: center;">Puntaje</th>
              <th style="padding: 10px; text-align: center;">Salidas (Anti-Cheat)</th>
              <th style="padding: 10px; text-align: center;">Hora Inicio / Fin</th>
              <th style="padding: 10px; text-align: center;">Acciones</th>
            </tr>
          </thead>
          <tbody>
    `;

    resultados.forEach(res => {
      const horaInicio = res.startTime ? new Date(res.startTime).toLocaleTimeString() : 'N/A';
      const horaFin = res.fecha ? new Date(res.fecha).toLocaleTimeString() : 'N/A';
      const salidas = res.tabSwitchCount !== undefined ? res.tabSwitchCount : 0;

      html += `
        <tr style="border-bottom: 1px solid #EAE3D9;">
          <td style="padding: 10px;">${res.studentName}</td>
          <td style="padding: 10px; text-align: center; color: #7A706A;">${res.studentGroup || '-'}</td>
          <td style="padding: 10px; text-align: center; font-weight: bold; color: #6B9080;">${res.puntajeObtenido} / ${res.puntajeTotal}</td>
          <td style="padding: 10px; text-align: center; color: ${salidas > 0 ? '#E07A5F' : '#6B9080'}; font-weight: bold;">${salidas} veces</td>
          <td style="padding: 10px; text-align: center; color: #7A706A; font-size: 0.8rem;">${horaInicio} - ${horaFin}</td>
          <td style="padding: 10px; text-align: center;">
            <button class="btn-secondary-sm" onclick="descargarExcelIndividual('${res.id}')">📄 Detalle</button>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  });
}

function descargarExcelGeneral(examId) {
  database.ref("resultados").orderByChild("examId").equalTo(examId).once("value", snapshot => {
    const datosTabla = [];
    
    snapshot.forEach(child => {
      const r = child.val();
      datosTabla.push({
        "Estudiante": r.studentName,
        "Grupo": r.studentGroup || "N/A",
        "Calificación": `${r.puntajeObtenido} / ${r.puntajeTotal}`,
        "Salidas (Anti-Cheat)": r.tabSwitchCount !== undefined ? r.tabSwitchCount : 0
      });
    });

    if (datosTabla.length === 0) {
      alert("No hay datos para exportar.");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(datosTabla);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Resultados Generales");

    XLSX.writeFile(workbook, `Reporte_General_Examen_${examId}.xlsx`);
  });
}

function descargarExcelIndividual(resultadoKey) {
  database.ref("resultados/" + resultadoKey).once("value", snapshot => {
    const r = snapshot.val();
    if (!r) {
      alert("No se encontró el detalle de este resultado.");
      return;
    }

    const detallePreguntas = [];
    if (r.respuestas && Array.isArray(r.respuestas)) {
      r.respuestas.forEach((resp, idx) => {
        detallePreguntas.push({
          "N° Pregunta": idx + 1,
          "Enunciado": resp.enunciado,
          "Respuesta del Estudiante": resp.respuesta !== null ? resp.respuesta : "Sin responder",
          "¿Está Correcta?": resp.esCorrecta ? "Sí" : "No",
          "Puntuación Aportada": resp.puntuacionAportada !== undefined ? resp.puntuacionAportada : 0
        });
      });
    }

    const worksheet = XLSX.utils.json_to_sheet(detallePreguntas);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Detalle Pregunta a Pregunta");

    XLSX.writeFile(workbook, `Reporte_${r.studentName.replace(/\s+/g, '_')}_Detalle.xlsx`);
  });
}