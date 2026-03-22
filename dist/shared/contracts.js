"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApprovalStatus = exports.TransactionStatus = exports.TransactionType = exports.GroupRole = void 0;
var GroupRole;
(function (GroupRole) {
    GroupRole["MEMBER"] = "member";
    GroupRole["SIGNATORY"] = "signatory";
})(GroupRole || (exports.GroupRole = GroupRole = {}));
var TransactionType;
(function (TransactionType) {
    TransactionType["DEPOSIT"] = "deposit";
    TransactionType["WITHDRAWAL"] = "withdrawal";
})(TransactionType || (exports.TransactionType = TransactionType = {}));
var TransactionStatus;
(function (TransactionStatus) {
    TransactionStatus["PENDING_APPROVAL"] = "pending_approval";
    TransactionStatus["APPROVED"] = "approved";
    TransactionStatus["REJECTED"] = "rejected";
    TransactionStatus["COMPLETED"] = "completed";
})(TransactionStatus || (exports.TransactionStatus = TransactionStatus = {}));
var ApprovalStatus;
(function (ApprovalStatus) {
    ApprovalStatus["APPROVED"] = "approved";
    ApprovalStatus["REJECTED"] = "rejected";
})(ApprovalStatus || (exports.ApprovalStatus = ApprovalStatus = {}));
