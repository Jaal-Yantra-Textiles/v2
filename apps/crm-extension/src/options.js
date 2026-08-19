import { getSettings, saveSettings } from "./api.js";

const $ = (id) => document.getElementById(id);

const settings = await getSettings();
$("baseUrl").value = settings.baseUrl;
$("token").value = settings.token;

$("save").addEventListener("click", async () => {
  await saveSettings($("baseUrl").value.trim(), $("token").value.trim());
  $("saved").textContent = "Saved";
  setTimeout(() => ($("saved").textContent = ""), 2000);
});
