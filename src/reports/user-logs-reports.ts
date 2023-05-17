import {firestore, storage} from "firebase-admin";
import {getAllDatesThatNeedsReportToGenerate} from "../util/pdfUtiliy";
import PDFDocument from "pdfkit-table";

interface UserLogs {
    email: string,
    datetime: string,
    activty: string
}

/**
 * @param {firestore.Firestore} firestore
 * @param {storage.Storage} storage;
 */
export async function generateUserLogsReports(firestore: firestore.Firestore, storage: storage.Storage) {
// TODO
  const dates = await getAllDatesThatNeedsReportToGenerate(firestore, "user-logs");
  const data = [];
  for (let i = 0; i < dates.length; i++) {
    const userLogs = await getUserLogsAsPerDate(firestore, new Date(dates[i]));
    if (userLogs.data.length != 0) {
      data.push(userLogs);
    }
  }

  for (let i = 0; i < data.length; i++) {
    const folder = "user-logs/";
    const date = data[i].date;
    const fileName = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const fileRef = storage.bucket().file(folder + fileName + ".pdf");
    const doc = new PDFDocument();
    const writeStream = fileRef.createWriteStream({
      resumable: false,
      contentType: "application/pdf",
    });
    doc.pipe(writeStream);
    doc.image(`${__dirname}/../resources/aqua.png`, 120, 20, {width: 75});
    doc.fontSize(10);
    doc.font("Helvetica").text("AQUA - A Cross-platform Application for Hydroponics Monitoring System", 200, 55, {align: "center", width: 200});
    doc.image(`${__dirname}/../resources/sblogo.png`, 405, 26, {width: 75});
    doc.font("Helvetica").text("SYSTEM REPORT FOR USER LOGS", 200, 100, {align: "center", width: 200});
    doc.rect(72, 120, 468, 20);
    doc.fill("#74FF99");
    doc.rect(72, 140, 468, 20);
    doc.fill("#0B0E98");
    doc.fill("#FFFFFF");
    doc.fontSize(15);
    doc.font("Helvetica-Bold").text("User Logs", 200, 145, {align: "center", width: 200});
    await doc.table({
      headers: [
        {label: "Email", property: "email", align: "center", headerColor: "#74FF99", headerOpacity: 1},
        {label: "Date/Time", property: "datetime", align: "center", headerColor: "#74FF99", headerOpacity: 1},
        {label: "Activity", property: "activity", align: "center", headerColor: "#74FF99", headerOpacity: 1},
      ],
      datas: data[i].data as unknown as {[key:string]: string}[],
    }, {x: 72, y: 164});
    doc.end();
  }
  const fileDate = dates[dates.length - 1];
  firestore.collection("reports").doc("user-logs").update({lastFileUploaded: `${fileDate.getFullYear()}-${fileDate.getMonth() + 1}-${fileDate.getDate()}`});
}

/**
 * @param {firestore.Firestore} firestore
 * @param {Date} date
 * @return {Promise<UserLogs[]>}
 */
async function getUserLogsAsPerDate(firestore: firestore.Firestore, date: Date) {
  const result = (await firestore.collection("user_logs")
    .where("timestamp", ">=", new Date(`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} 00:00:00`))
    .where("timestamp", "<=", new Date(`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} 23:59:59`))
    .orderBy("timestamp", "desc").get()).docs.map((value) => value.data() as UserLogs);
  return {date, data: result};
}
