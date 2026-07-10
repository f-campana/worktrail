#!/usr/bin/env node
import { installSqliteWarningFilter } from "./warnings.js";

installSqliteWarningFilter();

await import("./cli-main.js");
