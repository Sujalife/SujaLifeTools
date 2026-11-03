// Prints a public deterministic login address, never a password.
import {loginEmail, normalizeName} from '../functions/domain.mjs';
const name=process.argv.slice(2).join(' ');
try{console.log(JSON.stringify({displayName:normalizeName(name),loginAddress:loginEmail(name)},null,2));}catch(error){console.error(error.message);process.exitCode=1;}
