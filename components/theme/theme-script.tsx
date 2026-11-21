export const THEME_STORAGE_KEY = "theme"

/*
 * Runs in <head> before first paint so a saved dark theme never flashes light.
 * With no saved choice it follows the OS setting, including live changes.
 */
const script = `(function(){
var k=${JSON.stringify(THEME_STORAGE_KEY)},m=matchMedia("(prefers-color-scheme: dark)");
function apply(){var t=null;try{t=localStorage.getItem(k)}catch(e){}
var d=t?t==="dark":m.matches,r=document.documentElement;
r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}
apply();m.addEventListener("change",apply);
})()`

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
