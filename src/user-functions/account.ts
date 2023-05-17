/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {firestore, auth} from "firebase-admin";
import {logger} from "firebase-functions";
import {UserRecord} from "firebase-admin/auth";
import {AuthUserRecord} from "firebase-functions/lib/common/providers/identity";
import {CallableContext} from "firebase-functions/v1/https";
import * as functions from "firebase-functions";
import lodash from "lodash";
import * as admin from "firebase-admin";

export interface User {
  id?: string,
  email?: string,
  userLevel: string,
  name: string,
  password?: string,
  isEmailVerified?: boolean
}

export interface ActivationAndDeactivationPayload {
  id: string,
  disable: boolean
}

export interface UserList {
  users: User[]
}

/**
 * @param {firestore.Firestore} firestore - firestore instance
 * @param {AuthUserRecord} user - verified user object
 * @return {Promise<void>}
 */
export async function addUserLevelToClaims(firestore: firestore.Firestore, user: AuthUserRecord): Promise<void> {
  const userRef = firestore.collection("users").doc(user.uid);
  const doc = await userRef.get();
  logger.write({message: "User exsit", severity: "INFO", exist: doc.exists});
  if (doc.exists) {
    const userFromRecord = doc.data() as User;
    logger.write({message: "User exsit", severity: "INFO", userDetails: userFromRecord});
    const customClaims = userFromRecord.userLevel === "admin" ? {"admin": true} : {"member": true};
    return auth().setCustomUserClaims(user.uid, customClaims);
  } else {
    // TODO - insert to firestore as user
  }
}

/**
 *
 * @param {firestore.Firestore} firestore
 * @param {User} data
 * @param {CallableContext} context
 * @return {Promise<User>}
 */
export async function registerUser(firestore: firestore.Firestore, data: User, context: CallableContext): Promise<User> {
  if (context.auth?.token.admin) {
    const user:UserRecord = await auth().createUser({email: data.email, password: data.password});
    await firestore.collection("users").doc(user.uid).set({
      name: data.name,
      userLevel: data.userLevel,
    });
    return {
      id: user.uid,
      email: user.email,
      userLevel: data.userLevel,
      name: data.name,
    };
  }
  throw new functions.https.HttpsError("permission-denied", "Admin only access!");
}

/**
 * @param {firestore.Firestore} firestore
 * @param {CallableContext} context
 * @return {Promise<User>}
 */
export async function listUsers(firestore: firestore.Firestore, context: CallableContext): Promise<UserList> {
  if (context.auth?.token.admin) {
    const userRecords = await auth().listUsers();
    const userRef = await firestore.collection("users").get();
    const users = userRecords.users.map((userRecord: UserRecord) => {
      const user = userRef.docs.find((doc) => doc.id === userRecord.uid)?.data() as User;
      return {
        id: userRecord.uid,
        email: userRecord.email,
        userLevel: user.userLevel,
        name: user.name,
        isActive: !userRecord.disabled,
        isEmailVerified: userRecord.emailVerified,
      };
    });
    return {users};
  }
  throw new functions.https.HttpsError("permission-denied", "Admin only access!");
}

/**
 * @param {firestore.Firestore} firestore
 * @param {User} data
 * @param {CallableContext} context
 * @return {Promise<string>}
 */
export async function updateUser(firestore: firestore.Firestore, data: User, context: CallableContext): Promise<string> {
  validateUserPayload(data);
  if (context.auth?.token.admin) {
    const userDetails = {
      ...data.name != null && {name: data.name},
      ...data.userLevel != null && {userLevel: data.userLevel},
    };

    if (!lodash.isEmpty(userDetails)) {
      const userRef = await firestore.collection("users").doc(data.id!);
      await userRef.update(userDetails);
    }

    const userCredentials = {
      ...data.email != null && {email: data.email, emailVerified: false},
      ...data.password != null && {password: data.password},
    };

    if (!lodash.isEmpty(userCredentials)) {
      await auth().updateUser(data.id!, userCredentials);
    }
    return "Update user completed!";
  }
  throw new functions.https.HttpsError("permission-denied", "Admin only access!");
}

/**
 * @param {firestore.Firestore} firestore
 * @param {User} data
 * @param {CallableContext} context
 */
export async function deactivateOrActivateUser(firestore: firestore.Firestore, data: ActivationAndDeactivationPayload, context: CallableContext) {
  if (context.auth?.token.admin) {
    await auth().updateUser(data.id, {disabled: data.disable});
    return `User ${data.disable ? "Deactivated" : "Activated"}!`;
  }
  throw new functions.https.HttpsError("permission-denied", "Admin only access!");
}

/**
 * @param {firestore.Firestore} firestore
 * @param {CallableContext} context
 * @return {Promise<User>}
 */
export function getProfile(firestore: firestore.Firestore, context: CallableContext): Promise<User> {
  const id = context.auth?.uid ? context.auth.uid : "";
  return getUserInfo(firestore, id);
}

/**
 * @param {firestore.Firestore} firestore
 * @param {User} data
 * @param {CallableContext} context
 */
export async function updateProfile(firestore: firestore.Firestore, data: User, context: CallableContext): Promise<User> {
  const id = context.auth?.uid ? context.auth.uid : "";
  if (data.email) {
    await auth().updateUser(id, {email: data.email, emailVerified: false});
  }
  if (data.name) {
    await firestore.collection("users").doc(id).update({name: data.name});
  }
  return getUserInfo(firestore, id);
}

/**
 * @param {firestore.Firestore} firestore
 * @param {Object.<string, unknown>} data
 * @param {CallableContext} context
 */
export async function logActivity(firestore: firestore.Firestore, data: {[key:string]: unknown}, context: CallableContext) {
  const userId = context.auth?.uid ? context.auth.uid : "";
  const email = context.auth?.token?.email ? context.auth.token.email : "";
  await firestore.collection("user_logs").add({
    userId,
    email,
    ...data,
    timestamp: admin.firestore.Timestamp.fromDate(new Date(data["datetime"] as string)),
  });
}

/**
 *
 * @param {{}} data
 * @param {firestore.Firestore} firestore
 * @param {CallableContext} context
 * @return {firestore.DocumentData[]}
 */
export async function getUserLogs(data: {[key: string]: string}, firestore: firestore.Firestore, context: CallableContext) {
  if (context.auth?.token.admin) {
    const {keyword, date} = data != null ? data : {keyword: undefined, date: undefined};
    const docsRef = (await firestore.collection("user_logs").orderBy("timestamp", "desc").get());
    const condition = (data: {[key: string]: string}, key: string, search: string | undefined) => {
      if (search != null) {
        return data[key].includes(search);
      }
      return true;
    };
    const filter = (element: firestore.QueryDocumentSnapshot<firestore.DocumentData>) => {
      const data = element.data() as {[key: string]: string};
      return condition(data, "activity", keyword) && condition(data, "datetime", date);
    };
    return docsRef.docs.filter(filter).map((value) => value.data());
  }
  throw new functions.https.HttpsError("permission-denied", "Admin only access!");
}

/**
 * @param {User} payload - User payload
 */
function validateUserPayload(payload: User): void | never {
  if (payload.id != null) {
    return;
  }
  throw new functions.https.HttpsError("invalid-argument", "Please pass valid payload!");
}

/**
 * @param {firestore.Firestore} firestore
 * @param {string} id
 * @return {Promise<User>}
 */
async function getUserInfo(firestore: firestore.Firestore, id: string): Promise<User> {
  const user = (await firestore.collection("users").doc(id).get()).data() as User;
  const userRecord = await auth().getUser(id);
  return {
    email: userRecord.email,
    isEmailVerified: userRecord.emailVerified,
    ...user,
  };
}
