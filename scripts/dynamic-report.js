import {compareModes} from '../assets/dynamic-target.js';
import {compareRollingModes} from '../assets/rolling-target.js';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const {snapshot,now}=JSON.parse(raw);
process.stdout.write(JSON.stringify(snapshot.rollingForecast?compareRollingModes(snapshot,now):compareModes(snapshot,now)));
