import * as fs from 'fs';
import * as path from 'path';

const inputFilePath = process.argv[2];
if (!inputFilePath) {
  console.error('❌ Please provide path to entity file.');
  process.exit(1);
}

const fileContent = fs.readFileSync(inputFilePath, 'utf-8');
const fileName = path.basename(inputFilePath);
const entityFileNameWithoutExt = fileName.replace('.entity.ts', '');
const outputLogFileName = entityFileNameWithoutExt + '.log.entity.ts';
const outputLogFilePath = path.join(path.dirname(inputFilePath), outputLogFileName);

// แปลงเนื้อหา entity เป็น log entity
function convertToLogEntity(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  
  let insideClass = false;
  let skipBlock = false;
  let braceCount = 0;
  let className = '';
  let skipImportBlock = false;
  
  // เพิ่ม BaseLogEntity import และ typeorm imports ที่จำเป็น
  result.push("import { BaseLogEntity } from 'src/common/entities/base-log.entity';");
  result.push("import {");
  result.push("  Column,");
  result.push("  Entity,");
  result.push("  PrimaryColumn,");
  result.push("  Unique,");
  result.push("} from 'typeorm';");
  result.push("");
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // ข้าม import statements ทั้งหมด (รวมถึง multi-line imports)
    if (trimmedLine.startsWith('import')) {
      skipImportBlock = true;
      continue;
    }
    
    // ข้าม multi-line import จนกว่าจะจบด้วย } from 'xxx';
    if (skipImportBlock) {
      if (trimmedLine.includes("} from '") || trimmedLine.endsWith("';")) {
        skipImportBlock = false;
      }
      continue;
    }
    
    // ข้ามบรรทัดว่างก่อนถึง class
    if (!insideClass && trimmedLine === '') {
      continue;
    }
    
    // จัดการ @Entity decorator
    if (trimmedLine.includes('@Entity(')) {
      const newLine = line.replace(/'([^']+)'/, (match, entityName) => `'${entityName}_logs'`);
      result.push(newLine);
      continue;
    }
    
    // จัดการ @Unique decorator - เปลี่ยนชื่อให้มี _log suffix
    if (trimmedLine.includes('@Unique(')) {
      const newLine = line.replace(/'([^']+)'/, (match, uniqueName) => `'${uniqueName}_log'`);
      result.push(newLine);
      continue;
    }
    
    // จัดการ class declaration
    if (line.match(/export class (\w+)/)) {
      const classMatch = line.match(/export class (\w+)/);
      if (classMatch) {
        className = classMatch[1];
        result.push(`export class ${className}Log extends BaseLogEntity {`);
        insideClass = true;
        continue;
      }
    }
    
    if (!insideClass) {
      // ถ้ายังไม่ได้เข้า class ให้เพิ่มบรรทัดปกติ (เช่น decorators)
      if (trimmedLine && !trimmedLine.startsWith('import')) {
        result.push(line);
      }
      continue;
    }
    
    // ข้าม method blocks
    if (trimmedLine.includes('@BeforeInsert') || 
        trimmedLine.includes('@BeforeUpdate') ||
        (trimmedLine.includes('()') && (trimmedLine.includes('{') || trimmedLine.endsWith(')')))) {
      skipBlock = true;
      braceCount = 0;
      
      // นับ braces ในบรรทัดปัจจุบัน
      for (const char of line) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }
      
      // ถ้าเป็น method แบบ one-liner หรือ braces ปิดในบรรทัดเดียวกัน
      if (braceCount <= 0) {
        skipBlock = false;
      }
      continue;
    }
    
    if (skipBlock) {
      // นับ braces
      for (const char of line) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
      }
      
      // ออกจาก block เมื่อ braces ครบ
      if (braceCount <= 0) {
        skipBlock = false;
      }
      continue;
    }
    
    // ข้าม relation decorators
    if (trimmedLine.startsWith('@ManyToOne') || 
        trimmedLine.startsWith('@OneToMany') || 
        trimmedLine.startsWith('@OneToOne') || 
        trimmedLine.startsWith('@JoinColumn')) {
      continue;
    }
    
    // ข้าม relation fields (fields ที่ type เป็น class หรือ array ของ class)
    const fieldMatch = trimmedLine.match(/^(\w+):\s*([A-Z]\w+(\[\])?);?\s*$/);
    if (fieldMatch) {
      continue;
    }
    
    // ข้าม updatedAt field และ decorator ของมัน
    if (trimmedLine.includes('updatedAt') || 
        (i > 0 && lines[i + 1] && lines[i + 1].trim().includes('updatedAt'))) {
      continue;
    }
    
    // เปลี่ยน @PrimaryGeneratedColumn เป็น @PrimaryColumn
    if (trimmedLine.includes('@PrimaryGeneratedColumn')) {
      // ลบ options ออกและเปลี่ยนเป็น @PrimaryColumn
      result.push(line.replace(/@PrimaryGeneratedColumn\([^)]*\)/, '@PrimaryColumn()'));
      continue;
    }
    
    // ปิด class
    if (trimmedLine === '}' && insideClass) {
      result.push(line);
      break;
    }
    
    // เพิ่มบรรทัดปกติ
    if (trimmedLine || result[result.length - 1]?.trim() !== '') {
      result.push(line);
    }
  }
  
  return result.join('\n');
}

// ฟังก์ชันสร้างไฟล์ .ext.d.ts
function generateExtensionDeclaration(entityFilePath: string, entityClassName: string) {
  const typesDir = path.resolve(path.dirname(entityFilePath), '../types');
  const entityFileNameWithoutExt = path.basename(entityFilePath).replace('.entity.ts', '');
  const dtsFileName = `${entityFileNameWithoutExt}.ext.d.ts`;
  const dtsFilePath = path.join(typesDir, dtsFileName);

  const content = `import { ${entityClassName} } from "../entities/${entityFileNameWithoutExt}.entity";

declare module "../entities/${entityFileNameWithoutExt}.entity" {
  interface ${entityClassName} {
    removedBy?: number;
  }
}
`;

  fs.mkdirSync(typesDir, { recursive: true });
  fs.writeFileSync(dtsFilePath, content);
  console.log(`✅ Extension declaration generated: ${dtsFilePath}`);
}

function main() {
  const entityClassNameMatch = fileContent.match(/export class (\w+)/);
  if (!entityClassNameMatch) {
    console.error('❌ ไม่พบชื่อ class ในไฟล์ entity');
    process.exit(1);
  }
  const entityClassName = entityClassNameMatch[1];

  const logEntityContent = convertToLogEntity(fileContent);
  fs.writeFileSync(outputLogFilePath, logEntityContent, 'utf-8');
  console.log(`✅ Log entity generated: ${outputLogFilePath}`);

  generateExtensionDeclaration(inputFilePath, entityClassName);
}

main();