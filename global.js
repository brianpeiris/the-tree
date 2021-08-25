import { THREE } from "enable3d";

// HoloPlay looks for a global THREE
window.THREE = THREE;

// Disable HoloPlay's "no device" alert
window.alert = () => {}
