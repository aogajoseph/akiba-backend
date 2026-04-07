"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApprovalStatus = exports.TransactionSource = exports.TransactionStatus = exports.TransactionType = exports.GroupRole = void 0;
var GroupRole;
(function (GroupRole) {
    GroupRole["MEMBER"] = "member";
    GroupRole["SIGNATORY"] = "signatory";
})(GroupRole || (exports.GroupRole = GroupRole = {}));
var TransactionType;
(function (TransactionType) {
    TransactionType["DEPOSIT"] = "deposit";
    TransactionType["WITHDRAWAL"] = "withdrawal";
    TransactionType["FEE"] = "fee";
})(TransactionType || (exports.TransactionType = TransactionType = {}));
var TransactionStatus;
(function (TransactionStatus) {
    TransactionStatus["INITIATED"] = "initiated";
    TransactionStatus["PENDING"] = "pending";
    TransactionStatus["PENDING_APPROVAL"] = "pending_approval";
    TransactionStatus["APPROVED"] = "approved";
    TransactionStatus["REJECTED"] = "rejected";
    TransactionStatus["COMPLETED"] = "completed";
    TransactionStatus["FAILED"] = "failed";
    TransactionStatus["REVERSED"] = "reversed";
})(TransactionStatus || (exports.TransactionStatus = TransactionStatus = {}));
var TransactionSource;
(function (TransactionSource) {
    TransactionSource["MPESA"] = "mpesa";
    TransactionSource["MPESA_PAYBILL"] = "mpesa_paybill";
    TransactionSource["MPESA_STK"] = "mpesa_stk";
    TransactionSource["CARD"] = "card";
    TransactionSource["BANK_TRANSFER"] = "bank_transfer";
    TransactionSource["SYSTEM_FEE"] = "system_fee";
})(TransactionSource || (exports.TransactionSource = TransactionSource = {}));
var ApprovalStatus;
(function (ApprovalStatus) {
    ApprovalStatus["APPROVED"] = "approved";
    ApprovalStatus["REJECTED"] = "rejected";
})(ApprovalStatus || (exports.ApprovalStatus = ApprovalStatus = {}));
