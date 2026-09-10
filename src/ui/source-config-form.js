import { normalizeSources } from "../domain/source.js";

export function renderSourceConfigForm(container, sources) {
  container.replaceChildren(...sources.map(createSourceConfigRow));
}

export function readSourceConfigForm(container) {
  const rawSources = [...container.querySelectorAll(".source-config-row")].map((row) => ({
    id: row.dataset.sourceId,
    name: row.querySelector('[name="name"]').value,
    url: row.querySelector('[name="url"]').value,
    audioExpected: row.querySelector('[name="audioExpected"]').checked,
  }));
  return normalizeSources(rawSources);
}

function createSourceConfigRow(source, index) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "source-config-row";
  fieldset.dataset.sourceId = source.id;

  const legend = document.createElement("legend");
  legend.textContent = `窗口 ${index + 1}`;
  const nameField = createLabeledInput("名称", "text", source.name, "name");
  const urlField = createLabeledInput("视频地址", "text", source.url, "url");
  urlField.querySelector("input").placeholder = "rtsp://192.0.2.10/live 或 https://…/live.m3u8";

  const audioField = document.createElement("label");
  audioField.className = "check-label";
  const audioCheckbox = document.createElement("input");
  audioCheckbox.type = "checkbox";
  audioCheckbox.name = "audioExpected";
  audioCheckbox.checked = source.audioExpected;
  audioField.append(audioCheckbox, document.createTextNode("预期有声音"));

  fieldset.append(legend, nameField, urlField, audioField);
  return fieldset;
}

function createLabeledInput(labelText, type, value, name) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.value = value;
  input.autocomplete = "off";
  label.append(input);
  return label;
}
