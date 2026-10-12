import { batch, effect } from "@preact/signals";
import { h, render } from "preact";
import { loadData } from "./app/data.ts";
import { lang, setLang, t } from "./app/i18n.ts";
import { data, loadError, readUrl, startClock, startUrlSync } from "./app/state.ts";
import { App } from "./ui/App.tsx";
import { loadWeather } from "./ui/weather.ts";
import "./ui/styles.css";

// Language first, so even the loading message is in the requested language.
setLang(new URLSearchParams(location.search).get("lang"));
effect(() => {
  lang.value;
  document.title = t("app.documentTitle");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("app.description"));
});

render(h(App, null), document.getElementById("app")!);
startClock();

loadData()
  .then((d) => {
    batch(() => {
      data.value = d;
      readUrl(d);
    });
    startUrlSync();
    // Decorative and optional: fetched after the map is up.
    setTimeout(() => void loadWeather(), 1500);
  })
  .catch((e) => {
    console.error(e);
    loadError.value = true;
  });
